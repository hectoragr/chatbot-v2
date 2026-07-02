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
//   aws ssm put-parameter --name /chatbot-v2/prod/OPENAI_API_KEY       --value "sk-..." --type SecureString
//   aws ssm put-parameter --name /chatbot-v2/prod/DEEPSEEK_API_KEY     --value "sk-..." --type SecureString
//   aws ssm put-parameter --name /chatbot-v2/prod/ADMIN_EMAIL          --value "..." --type String
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

    // Statement 3: InvokeFunction ONLY on admin-fn
    serverFnRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'InvokeAdminFnOnly',
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [adminFn.functionArn],
      }),
    );

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
        OPENAI_API_KEY: ssmParam('OPENAI_API_KEY'),
        DEEPSEEK_API_KEY: ssmParam('DEEPSEEK_API_KEY'),
        ADMIN_EMAIL: ssmParam('ADMIN_EMAIL'),
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
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
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
