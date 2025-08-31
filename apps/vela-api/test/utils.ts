import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

export function createMockAPIGatewayEvent(
  method: string,
  path: string,
  body?: string,
  headers: Record<string, string> = {},
): APIGatewayProxyEvent {
  return {
    httpMethod: method,
    path,
    headers,
    queryStringParameters: null,
    body: body || null,
    isBase64Encoded: false,
    requestContext: {
      accountId: '123456789',
      apiId: 'test-api',
      httpMethod: method,
      path,
      stage: 'test',
      requestId: 'test-request-id',
      resourceId: 'test-resource-id',
      resourcePath: path,
      identity: {
        sourceIp: '127.0.0.1',
        userAgent: 'test-agent',
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        user: null,
        userArn: null,
        clientCert: null,
      },
      authorizer: null,
      protocol: 'HTTP/1.1',
      requestTime: '09/Apr/2015:12:34:56 +0000',
      requestTimeEpoch: 1428582896000,
    },
    resource: path,
    pathParameters: null,
    stageVariables: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    version: '1.0',
  };
}

export function createMockContext(): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'test-function',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789:function:test-function',
    memoryLimitInMB: '128',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/test-function',
    logStreamName: '2023/08/31/[$LATEST]test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  };
}
