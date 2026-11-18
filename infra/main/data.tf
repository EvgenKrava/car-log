resource "aws_dynamodb_table" "main" {
  name         = var.project
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  # Free: lets a bad deploy or a bad script be undone to any second of the last 35 days.
  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = true
}

resource "aws_s3_bucket" "photos" {
  bucket = "${var.project}-photos-${local.account_id}"
}

resource "aws_s3_bucket_public_access_block" "photos" {
  bucket                  = aws_s3_bucket.photos.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id
  cors_rule {
    # POST: uploads are presigned S3 POST policies (size-bounded); GET: presigned reads.
    allowed_methods = ["PUT", "POST", "GET"]
    allowed_origins = local.origins
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id

  rule {
    id     = "abort-multipart"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
  # Uploaded import files and scans are transient job inputs.
  rule {
    id     = "imports"
    status = "Enabled"
    filter { prefix = "imports/" }
    expiration { days = 1 }
  }
  rule {
    id     = "scans"
    status = "Enabled"
    filter { prefix = "scans/" }
    expiration { days = 1 }
  }
  # Chat attachments live as long as their session (7-day DynamoDB TTL).
  rule {
    id     = "chat"
    status = "Enabled"
    filter { prefix = "chat/" }
    expiration { days = 7 }
  }
}
