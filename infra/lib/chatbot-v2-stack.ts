/**
 * chatbot-v2 CDK Stack
 *
 * Deploys:
 *   1. Imports 7 existing DynamoDB tables by name
 *   2. admin-fn Lambda  — privileged role (grantReadWriteData on all 7 tables)
 *   3. Server Lambda    — user-scoped role (Get/Put/Update/Query on all 7 tables;
 *                         DeleteItem ONLY on Conversations; can invoke admin-fn only)
 *   4. S3 assets bucket + CloudFront distribution (Option A: manual constructs)
 *   5. Custom domain: chat.hectoragomez.com via ACM + Route53
 *
 * SIMPLIFICATION NOTE:
 *   CloudFront behaviours are simplified to two origins:
 *     - Default (*): server Lambda Function URL
 *     - /_next/* and /assets/*: S3 origin (static files)
 *   The image-optimization and revalidation sub-Lambdas from the open-next
 *   output.json are NOT wired up in this stack (they are optional for synth
 *   correctness). Add them before a production deploy.
 *
 * Secrets/env vars that require SSM values at deploy time are listed as
 * TODO comments below — they mirror the chatbot-api pattern under /chatbot-v2/prod.
 */

import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

// ─── Table names (must already exist in the account) ──────────────────────────
const TABLE_NAMES = [
  'Tokens',
  'Users',
  'Conversations',
  'RateLimits',
  'TokenRequests',
  'Usage',
  'Blocks',
] as const;

// SSM parameter prefix for chatbot-v2 secrets
// Populate before deploying:
//   aws ssm put-parameter --name /chatbot-v2/prod/CSRF_SECRET         --value "..." --type SecureString
//   aws ssm put-parameter --name /chatbot-v2/prod/AUTH0_SECRET         --value "..." --type SecureString
//   aws ssm put-parameter --name /chatbot-v2/prod/AUTH0_CLIENT_ID      --value "..." --type String
//   aws ssm put-parameter --name /chatbot-v2/prod/AUTH0_CLIENT_SECRET  --value "..." --type SecureString
//   aws ssm put-parameter --name /chatbot-v2/prod/AUTH0_DOMAIN         --value "your-tenant.us.auth0.com" --type String
//   aws ssm put-parameter --name /chatbot-v2/prod/ADMIN_EMAIL          --value "..." --type String
// Bedrock needs NO SSM secret — it is IAM-billed (see the ServerFnRole
// BedrockInvokeInferenceProfiles statement below).
const SSM_PREFIX = '/chatbot-v2/prod';

export interface ChatbotV2StackProps extends cdk.StackProps {
  /** e.g. 'chat.hectoragomez.com' */
  domainName?: string;
  /** Route 53 hosted zone ID */
  hostedZoneId?: string;
  /** Route 53 hosted zone name, e.g. 'hectoragomez.com' */
  hostedZoneName?: string;
}

export class ChatbotV2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ChatbotV2StackProps = {}) {
    super(scope, id, props);

    const { domainName, hostedZoneId, hostedZoneName } = props;

    // ── SSM helpers (resolved by CloudFormation at deploy time) ───────────────
    const ssmParam = (name: string) =>
      ssm.StringParameter.valueForStringParameter(this, `${SSM_PREFIX}/${name}`);

    // ── 1. Import existing DynamoDB tables ─────────────────────────────────────
    const tables = TABLE_NAMES.map((name) =>
      dynamodb.Table.fromTableName(this, `Table${name}`, name),
    );
    const conversationsTable = tables[TABLE_NAMES.indexOf('Conversations')];

    // New tables owned by this stack (batch 2) — created, not imported.
    const localesTable = new dynamodb.Table(this, 'LocalesTable', {
      tableName: 'Locales',
      partitionKey: { name: 'lang', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const adminDocsTable = new dynamodb.Table(this, 'AdminDocsTable', {
      tableName: 'AdminDocs',
      partitionKey: { name: 'doc_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── 2. admin-fn Lambda (privileged role) ───────────────────────────────────
    // NodejsFunction uses esbuild to bundle admin-fn/handler.ts.
    // Role is auto-created by NodejsFunction; grantReadWriteData adds full CRUD
    // (BatchGetItem, BatchWriteItem, DeleteItem, GetItem, PutItem, Query, Scan,
    //  UpdateItem) via the AWS managed DynamoDBFullAccess-like inline policy.
    const projectRoot = path.resolve(__dirname, '../..');
    const adminFnLogGroup = new logs.LogGroup(this, 'AdminFnLogs', {
      logGroupName: '/aws/lambda/chatbot-v2-admin',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const adminFn = new NodejsFunction(this, 'AdminFn', {
      functionName: 'chatbot-v2-admin',
      entry: path.join(projectRoot, 'admin-fn/handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      logGroup: adminFnLogGroup,
      depsLockFilePath: path.join(projectRoot, 'package-lock.json'),
      bundling: {
        format: OutputFormat.ESM,
        externalModules: ['@aws-sdk/*'],
        target: 'node22',
      },
    });

    // Grant admin-fn full read/write on all 7 tables
    tables.forEach((table) => table.grantReadWriteData(adminFn));

    // Grant admin-fn full read/write on the batch-2 tables too (manages
    // Locales cache entries and AdminDocs content via the same op switch).
    localesTable.grantReadWriteData(adminFn);
    adminDocsTable.grantReadWriteData(adminFn);

    // ── 3. Server Lambda (user-scoped role) ────────────────────────────────────
    // Option A: manual lambda.Function from .open-next/server-functions/default
    // Handler is index.handler (index.mjs exports handler).
    const serverFnLogGroup = new logs.LogGroup(this, 'ServerFnLogs', {
      logGroupName: '/aws/lambda/chatbot-v2-server',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create a scoped execution role for the server function
    const serverFnRole = new iam.Role(this, 'ServerFnRole', {
      roleName: 'chatbot-v2-server-fn-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole',
        ),
      ],
      description: 'User-scoped execution role for chatbot-v2 server Lambda',
    });

    // Attach scoped DynamoDB policy:
    //   - Get/Put/Update/Query on ALL 7 tables + their indexes
    //   - DeleteItem ONLY on Conversations (not Users/Tokens)
    //   - NO Scan anywhere
    const tableArns = tables.map((t) => t.tableArn);
    const indexArns = tables.map((t) => `${t.tableArn}/index/*`);

    // Statement 1: Get/Put/Update/Query on all 7 tables + indexes
    serverFnRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'DdbUserScopedReadWrite',
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:Query',
        ],
        resources: [...tableArns, ...indexArns],
      }),
    );

    // Statement 2: DeleteItem ONLY on the Conversations table
    serverFnRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'DdbDeleteConversationsOnly',
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:DeleteItem'],
        resources: [conversationsTable.tableArn],
      }),
    );

    // Statement 2b: Scan ONLY on the Tokens table.
    // Subject resolution (lib/subject.ts → listTokens) scans Tokens filtered by
    // user_id; the table has no GSI on user_id, so Scan is required here.
    const tokensTable = tables[TABLE_NAMES.indexOf('Tokens')];
    serverFnRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'DdbScanTokensOnly',
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:Scan'],
        resources: [tokensTable.tableArn],
      }),
    );

    // Batch-2 tables: server reads/writes the Locales cache (LLM-generated UI
    // translations) but only reads AdminDocs (content is admin-managed).
    localesTable.grantReadWriteData(serverFnRole);
    adminDocsTable.grantReadData(serverFnRole);

    // Bedrock: the server Lambda invokes foundation models via the `us.`
    // cross-region inference profiles (Converse / InvokeModel). A profile call
    // requires invoke permission on BOTH the inference-profile ARN AND the
    // underlying foundation-model ARNs in every region the profile can route to
    // (us-east-1 / us-east-2 / us-west-2). Scoped to this account's profiles and
    // to the foundation models (foundation-model ARNs are account-agnostic, so
    // the resource uses '*' for the account segment). This IAM grant is now the
    // ONLY thing that authorizes model invocation — AWS retired the per-model
    // "Model access" console page; serverless models auto-enable on first call.
    serverFnRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'BedrockInvokeInferenceProfiles',
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
          'arn:aws:bedrock:*::foundation-model/*',
        ],
      }),
    );

    // Statement 3: InvokeFunction ONLY on admin-fn
    serverFnRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'InvokeAdminFnOnly',
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [adminFn.functionArn],
      }),
    );

    // Statement 4: SES — contact-form + token-request notification emails
    // (lib/email.ts).
    serverFnRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SesSendEmail',
        effect: iam.Effect.ALLOW,
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [`arn:aws:ses:*:${this.account}:identity/*`],
      }),
    );

    // Deploy-safe tuning env: read each knob from CDK context (undefined when
    // not supplied), then drop the undefined ones so unset knobs fall back to
    // the code defaults in lib/limitsConfig.ts. Never touches SSM, so a missing
    // value can never fail the deploy.
    const TUNING_KEYS = [
      'BURST_WINDOW_SEC', 'BURST_MAX', 'AUTO_BLOCK_TTL_SEC',
      'IP_HOURLY_MAX', 'IP_HOURLY_WINDOW_SEC', 'IP_DAILY_MAX', 'IP_DAILY_WINDOW_SEC',
      'ANON_QUESTIONS', 'ANON_TOKENS', 'UNAPPROVED_TOKENS', 'DAILY_TOKENS',
      'GLOBAL_DAILY_TOKENS', 'ANON_CAPTCHA_REQUIRED',
    ] as const;
    const tuningEnv: Record<string, string> = {};
    for (const k of TUNING_KEYS) {
      const v = this.node.tryGetContext(k);
      if (v !== undefined && v !== null && `${v}` !== '') tuningEnv[k] = `${v}`;
    }

    const serverFn = new lambda.Function(this, 'ServerFn', {
      functionName: 'chatbot-v2-server',
      // .open-next/server-functions/default contains index.mjs
      code: lambda.Code.fromAsset(
        path.join(projectRoot, '.open-next/server-functions/default'),
      ),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      role: serverFnRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 1024,
      logGroup: serverFnLogGroup,
      environment: {
        NODE_ENV: 'production',
        // NOTE: AWS_REGION is reserved — Lambda sets it automatically from the
        // deployment region. Do NOT set it explicitly here.
        ADMIN_FN_NAME: adminFn.functionName,
        // TODO: populate these SSM params before deploying
        // CSRF token signing secret — lib/csrf.ts falls back to an insecure
        // default if this is unset, so it MUST be provided in production.
        CSRF_SECRET: ssmParam('CSRF_SECRET'),
        // Auth0 v4 SDK (@auth0/nextjs-auth0) reads AUTH0_DOMAIN + APP_BASE_URL
        // (not the v3 AUTH0_ISSUER_BASE_URL / NEXTAUTH_URL names).
        AUTH0_SECRET: ssmParam('AUTH0_SECRET'),
        AUTH0_CLIENT_ID: ssmParam('AUTH0_CLIENT_ID'),
        AUTH0_CLIENT_SECRET: ssmParam('AUTH0_CLIENT_SECRET'),
        AUTH0_DOMAIN: ssmParam('AUTH0_DOMAIN'),
        AUTH0_SCOPE: 'openid profile email',
        APP_BASE_URL: domainName ? `https://${domainName}` : '',
        // Bedrock is IAM-billed — no API keys. Region defaults to the stack
        // region (us-east-1) in lib/providers.ts; override only to split
        // Bedrock into another region (not recommended — adds a cross-region hop).
        ADMIN_EMAIL: ssmParam('ADMIN_EMAIL'),

        // ── Abuse / quota / kill-switch tuning knobs (lib/limitsConfig.ts) ─────
        // These let ops retune limits WITHOUT a code change. They are OPTIONAL:
        // every one has a safe built-in default in lib/limitsConfig.ts, so the
        // service behaves identically when they are unset. We wire them from
        // CDK context (`-c KEY=VALUE` or cdk.json context) rather than from
        // ssm.valueForStringParameter, because a missing SSM parameter makes
        // valueForStringParameter FAIL the deploy — and these must stay
        // deploy-safe when unset. An entry whose context value is undefined is
        // filtered out below, so it never reaches the Lambda env and the code
        // default wins.
        //
        // To promote any of these to an SSM-backed override instead, create the
        // parameter and swap the value for `ssmParam('<NAME>')`, e.g.:
        //   aws ssm put-parameter --name /chatbot-v2/prod/GLOBAL_DAILY_TOKENS --value "5000000" --type String
        //   aws ssm put-parameter --name /chatbot-v2/prod/ANON_QUESTIONS      --value "3"       --type String
        //   ...then: GLOBAL_DAILY_TOKENS: ssmParam('GLOBAL_DAILY_TOKENS'),
        ...tuningEnv,
      },
    });

    // Grant CloudWatch Logs write access for the server log group
    serverFnLogGroup.grantWrite(serverFn);

    // ── 4. S3 assets bucket + CloudFront distribution ─────────────────────────
    const assetsBucket = new s3.Bucket(this, 'AssetsBucket', {
      bucketName: `chatbot-v2-assets-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // Deploy static assets from .open-next/assets to S3
    new s3deploy.BucketDeployment(this, 'AssetsDeployment', {
      sources: [
        s3deploy.Source.asset(
          path.join(projectRoot, '.open-next/assets'),
        ),
      ],
      destinationBucket: assetsBucket,
      // OpenNext serves static assets at /_next/* and public files at root, so
      // deploy to the bucket root (no prefix) to match the request paths.
      prune: false,
    });

    // Server function URL (used as CloudFront origin for dynamic requests)
    const serverFnUrl = serverFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    // ACM certificate (must be in us-east-1 for CloudFront)
    let certificate: acm.ICertificate | undefined;
    let hostedZone: route53.IHostedZone | undefined;

    if (domainName && hostedZoneId && hostedZoneName) {
      hostedZone = route53.HostedZone.fromHostedZoneAttributes(
        this,
        'HostedZone',
        { hostedZoneId, zoneName: hostedZoneName },
      );

      certificate = new acm.Certificate(this, 'Certificate', {
        domainName,
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });
    }

    // S3 origin for static assets
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(assetsBucket);

    // Server Lambda function URL origin
    // Extract hostname from the function URL token for the HttpOrigin
    const serverOrigin = new origins.FunctionUrlOrigin(serverFnUrl);

    // Origin request policy for the dynamic (server Lambda) behavior.
    //
    // WHY a custom policy: the managed ALL_VIEWER_EXCEPT_HOST_HEADER forwards
    // every *viewer-sent* header but does NOT include CloudFront-MANAGED headers
    // (the `CloudFront-*` family CloudFront adds at the edge). Our
    // spoofing-resistant client-IP resolution (lib/anon.ts clientIp) needs
    // `CloudFront-Viewer-Address` — the real TCP peer address CloudFront adds,
    // which a client cannot forge. Without it the origin would fall back to the
    // (spoofable) X-Forwarded-For and the IP-based abuse controls could be
    // bypassed.
    //
    // WHY an allow-list (not `.all(...)`): the origin is a Lambda **Function
    // URL**. Forwarding the viewer `Host` header to a Function URL origin breaks
    // it (Host must match the FURL domain — this is exactly why the managed
    // policy is the *_EXCEPT_HOST_HEADER* variant). This CDK version has no
    // single "all-viewer-except-host PLUS a CloudFront header" builder, so we
    // enumerate the headers the app actually consumes at the origin and add
    // CloudFront-Viewer-Address, while deliberately NOT forwarding Host.
    // Cookies (CSRF/auth) and query strings are forwarded in full below.
    const serverOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'ServerOriginRequestPolicy', {
      originRequestPolicyName: 'chatbot-v2-server-viewer-headers',
      comment: 'Forward app headers + CloudFront-Viewer-Address (spoof-resistant client IP); Host excluded for Function URL origin.',
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
        // App-consumed viewer headers
        'x-csrf-token',
        'content-type',
        'authorization',
        'accept',
        'accept-language',
        'user-agent',
        'referer',
        'origin',
        'x-forwarded-for',
        'x-real-ip',
        // CloudFront-managed header: the un-spoofable viewer IP:PORT that
        // lib/anon.ts clientIp() prefers. Allowed here because it is added by
        // CloudFront at the edge, not sent by the viewer.
        'CloudFront-Viewer-Address',
      ),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
    });

    // CloudFront distribution
    // Behaviours:
    //   /_next/* → S3 (versioned static files, served at bucket root)
    //   *        → server Lambda (default behaviour)
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: serverOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        // Custom policy (above) forwards CloudFront-Viewer-Address so the origin
        // can resolve a spoof-resistant client IP; the managed
        // ALL_VIEWER_EXCEPT_HOST_HEADER does NOT include CloudFront-managed headers.
        originRequestPolicy: serverOriginRequestPolicy,
      },
      additionalBehaviors: {
        '/_next/*': {
          origin: s3Origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
      },
      domainNames: domainName ? [domainName] : undefined,
      certificate: certificate,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      comment: 'chatbot-v2 Next.js site via OpenNext',
    });

    // Route53 A record → CloudFront distribution
    if (domainName && hostedZone) {
      new route53.ARecord(this, 'AliasRecord', {
        zone: hostedZone,
        recordName: domainName,
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(distribution),
        ),
      });
    }

    // ── 5. Outputs ─────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'SiteUrl', {
      value: domainName
        ? `https://${domainName}`
        : `https://${distribution.distributionDomainName}`,
      description: 'Chatbot v2 site URL (CloudFront)',
    });

    new cdk.CfnOutput(this, 'CloudFrontDomain', {
      value: distribution.distributionDomainName,
      description: 'CloudFront distribution domain name',
    });

    new cdk.CfnOutput(this, 'AdminFnName', {
      value: adminFn.functionName,
      description: 'admin-fn Lambda function name',
    });

    new cdk.CfnOutput(this, 'ServerFnName', {
      value: serverFn.functionName,
      description: 'Server Lambda function name',
    });

    new cdk.CfnOutput(this, 'AssetsBucketName', {
      value: assetsBucket.bucketName,
      description: 'S3 bucket for static assets',
    });
  }
}
