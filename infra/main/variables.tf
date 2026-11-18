variable "region" {
  type    = string
  default = "us-east-1"
}

variable "aws_profile" {
  type    = string
  default = "yevhenii"
}

variable "project" {
  type    = string
  default = "carlog"
}

variable "zone_name" {
  type    = string
  default = "onlytools.click"
}

# The new stack first runs beside the CDK one on a test address. Once it is verified and the
# CDK stack is gone, this becomes carlog.onlytools.click.
variable "web_domain" {
  type    = string
  default = "carlog.onlytools.click"
}

variable "dev_origin" {
  type    = string
  default = "http://localhost:5173"
}

variable "api_dist_dir" {
  description = "esbuild output of apps/api (pnpm --filter @carlog/api bundle)"
  type        = string
  default     = "../../apps/api/dist"
}
