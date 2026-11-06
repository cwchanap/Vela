import { defaultIsContentTypeBinary } from 'hono/aws-lambda';

// text/event-stream must stay text through the Lambda proxy: the default
// binary check base64-encodes it, and the REST API declares no
// binaryMediaTypes, so API Gateway would forward base64 the browser cannot
// parse as SSE.
export const isLambdaContentTypeBinary = (contentType: string): boolean =>
  !contentType.startsWith('text/event-stream') && defaultIsContentTypeBinary(contentType);
