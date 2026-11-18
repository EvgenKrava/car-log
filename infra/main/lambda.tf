data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/${var.api_dist_dir}"
  output_path = "${path.module}/.build/api.zip"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.fn_name}"
  retention_in_days = 14
}

resource "aws_lambda_function" "api" {
  function_name    = local.fn_name
  role             = aws_iam_role.api.arn
  handler          = "handler.handler"
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  # 300 s: detached import-worker invocations (async self-invoke) chunk large files through
  # the model and need minutes. HTTP calls are still capped at 30 s by API Gateway.
  timeout     = 300
  memory_size = 256
  # No reserved concurrency: the account's concurrency quota is 10 and AWS rejects any reservation.

  environment {
    variables = {
      TABLE_NAME          = aws_dynamodb_table.main.name
      PHOTOS_BUCKET       = aws_s3_bucket.photos.bucket
      USER_POOL_ID        = nonsensitive(data.aws_ssm_parameter.pool_id.value)
      API_ID              = aws_apigatewayv2_api.main.id
      VAPID_PUBLIC_KEY    = nonsensitive(data.aws_ssm_parameter.vapid_public.value)
      VAPID_PRIVATE_KEY   = data.aws_ssm_parameter.vapid_private.value
      VAPID_SUBJECT       = "mailto:admin@carlog.app"
      ANTHROPIC_KEY_PARAM = local.anthropic_key_param
    }
  }

  depends_on = [aws_cloudwatch_log_group.api]
}

data "aws_iam_policy_document" "assume_lambda" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = local.fn_name
  assume_role_policy = data.aws_iam_policy_document.assume_lambda.json
}

data "aws_iam_policy_document" "api" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.api.arn}:*"]
  }
  statement {
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
      "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem",
      "dynamodb:ConditionCheckItem", "dynamodb:TransactWriteItems",
    ]
    resources = [aws_dynamodb_table.main.arn]
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.photos.arn}/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.photos.arn]
  }
  # The import worker runs as a detached async invocation of this same function.
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = ["arn:aws:lambda:${var.region}:${local.account_id}:function:${local.fn_name}"]
  }
  # Shared pool: the app only manages its own groups and reads users. It never deletes an
  # Only Tools account; "delete" in CarLog removes the carlog-user role.
  statement {
    actions = [
      "cognito-idp:ListUsersInGroup",
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:AdminRemoveUserFromGroup",
      "cognito-idp:AdminGetUser",
    ]
    resources = [nonsensitive(data.aws_ssm_parameter.pool_arn.value)]
  }
  statement {
    actions   = ["cloudwatch:GetMetricData", "transcribe:StartStreamTranscription"]
    resources = ["*"]
  }
  statement {
    actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = [
      "arn:aws:bedrock:${var.region}:${local.account_id}:inference-profile/us.anthropic.claude-haiku-5-5",
      "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-5-5",
      "arn:aws:bedrock:${var.region}:${local.account_id}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0",
      "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
    ]
  }
  statement {
    actions   = ["ssm:GetParameter", "ssm:PutParameter", "ssm:DeleteParameter"]
    resources = ["arn:aws:ssm:${var.region}:${local.account_id}:parameter${local.anthropic_key_param}"]
  }
}

resource "aws_iam_role_policy" "api" {
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

# Daily reminder notifications (~07:00 UTC), same self-invoke pattern as the import worker.
resource "aws_cloudwatch_event_rule" "notify" {
  name                = "${var.project}-daily-notify"
  schedule_expression = "cron(0 7 * * ? *)"
}

resource "aws_cloudwatch_event_target" "notify" {
  rule  = aws_cloudwatch_event_rule.notify.name
  arn   = aws_lambda_function.api.arn
  input = jsonencode({ jobType = "notify" })
}

resource "aws_lambda_permission" "notify" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.notify.arn
}
