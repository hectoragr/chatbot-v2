#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ChatbotV2Stack } from '../lib/chatbot-v2-stack';

const app = new cdk.App();

new ChatbotV2Stack(app, 'ChatbotV2Stack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
  domainName: 'chat.hectoragomez.com',
  hostedZoneId: 'Z01423473OIRTW86CLXNU',
  hostedZoneName: 'hectoragomez.com',
});
