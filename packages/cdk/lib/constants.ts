// Default production website domain. Used as the fallback when
// `VELA_DOMAIN_NAME` is unset and no CloudFormation `WebsiteOrigin` output is
// available (older stack deployed before that output existed). Every stack
// that derives CORS allow-lists, Cognito redirect URIs, CloudFront custom
// domains, or S3 CORS policy from the website domain MUST read this constant
// instead of inlining the literal, so a default-domain change is a one-line
// edit with no risk of the stacks drifting apart.
export const DEFAULT_WEBSITE_DOMAIN = 'vela.cwchanap.dev';
