import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Bucket, BlockPublicAccess, HttpMethods } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { getTtsAudioBucketName } from './naming';

declare const process: any;

export interface StorageStackProps extends StackProps {}

export class StorageStack extends Stack {
  public readonly ttsAudioBucket: Bucket;

  constructor(scope: Construct, id: string, props?: StorageStackProps) {
    super(scope, id, props);

    const frontendOrigins = process.env.FRONTEND_ORIGINS
      ? process.env.FRONTEND_ORIGINS.split(',').map((origin: string) => origin.trim())
      : [];

    if (process.env.NODE_ENV !== 'production') {
      frontendOrigins.push('http://localhost:9000');
    }

    const domainName = 'vela.cwchanap.dev';

    if (frontendOrigins.length === 0) {
      frontendOrigins.push(`https://${domainName}`);
    }

    const ttsAudioBucket = new Bucket(this, 'VelaTTSAudioBucket', {
      bucketName: getTtsAudioBucketName(this),
      publicReadAccess: false,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      versioned: false,
      cors: [
        {
          allowedMethods: [HttpMethods.GET, HttpMethods.HEAD],
          allowedOrigins: frontendOrigins,
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
    });

    this.ttsAudioBucket = ttsAudioBucket;
  }
}
