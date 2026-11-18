terraform {
  required_version = ">= 1.10"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.7" }
  }
  # State lives in the shared Only Tools state bucket (created by only-tools-core/infra/bootstrap).
  backend "s3" {
    bucket       = "onlytools-tfstate-898836755334"
    key          = "carlog/main.tfstate"
    region       = "us-east-1"
    profile      = "yevhenii"
    use_lockfile = true
  }
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile
  default_tags {
    tags = { Project = var.project, ManagedBy = "terraform" }
  }
}
