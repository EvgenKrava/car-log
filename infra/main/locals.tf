data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  web_origin = "https://${var.web_domain}"
  origins    = [local.web_origin, var.dev_origin]
  fn_name    = "${var.project}-api"

  # SSM parameters that hold secrets. The VAPID keys and the Claude API key already exist
  # (created for the CDK stack); Terraform only reads them.
  anthropic_key_param = "/carlog/anthropic-api-key"
}

# Sign-in is the shared Only Tools pool; only-tools-core publishes its ids in SSM.
data "aws_ssm_parameter" "pool_id" { name = "/onlytools/auth/user-pool-id" }
data "aws_ssm_parameter" "pool_arn" { name = "/onlytools/auth/user-pool-arn" }
data "aws_ssm_parameter" "issuer" { name = "/onlytools/auth/issuer" }
data "aws_ssm_parameter" "client" { name = "/onlytools/auth/clients/carlog" }

data "aws_ssm_parameter" "vapid_public" { name = "/carlog/vapid-public-key" }
data "aws_ssm_parameter" "vapid_private" {
  name            = "/carlog/vapid-private-key"
  with_decryption = true
}
