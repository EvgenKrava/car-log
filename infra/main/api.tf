resource "aws_apigatewayv2_api" "main" {
  name          = var.project
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = local.origins
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
  }
}

resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.main.id
  name             = "only-tools"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  jwt_configuration {
    issuer   = nonsensitive(data.aws_ssm_parameter.issuer.value)
    audience = [nonsensitive(data.aws_ssm_parameter.client.value)]
  }
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

locals {
  # Explicit routes (not a {proxy+}): the router reads the named path parameters.
  # Keep in sync with apps/api/src/router.ts.
  routes = {
    "/cars"                                                = ["GET", "POST"]
    "/cars/{id}"                                           = ["GET", "PUT", "DELETE"]
    "/cars/{id}/events"                                    = ["GET", "POST"]
    "/cars/{id}/events/{eventId}"                          = ["GET", "PUT", "DELETE"]
    "/cars/{id}/events/{eventId}/proofs"                   = ["GET", "POST"]
    "/cars/{id}/events/{eventId}/proofs/presign"           = ["POST"]
    "/cars/{id}/events/{eventId}/proofs/from-scan"         = ["POST"]
    "/cars/{id}/events/{eventId}/proofs/{proofId}"         = ["DELETE"]
    "/cars/{id}/reminders"                                 = ["GET", "POST"]
    "/cars/{id}/reminders/{reminderId}"                    = ["PUT", "DELETE"]
    "/cars/{id}/reminders/{reminderId}/complete"           = ["POST"]
    "/cars/{id}/chat/sessions"                             = ["GET", "POST"]
    "/cars/{id}/chat/sessions/{sid}"                       = ["GET", "PUT", "DELETE"]
    "/cars/{id}/chat/sessions/{sid}/messages"              = ["POST"]
    "/cars/{id}/chat/sessions/{sid}/actions/{aid}/confirm" = ["POST"]
    "/cars/{id}/chat/sessions/{sid}/actions/{aid}/decline" = ["POST"]
    "/cars/{id}/chat/attachments/presign"                  = ["POST"]
    "/cars/{id}/chat/transcribe"                           = ["POST"]
    "/cars/{id}/sharing"                                   = ["PUT"]
    "/import/extract"                                      = ["POST"]
    "/import/car"                                          = ["POST"]
    "/import/presign"                                      = ["POST"]
    "/import/jobs"                                         = ["GET", "POST"]
    "/import/jobs/{jobId}"                                 = ["GET", "DELETE"]
    "/import/scan/presign"                                 = ["POST"]
    "/import/scan"                                         = ["POST"]
    "/admin/users"                                         = ["GET"]
    "/admin/users/{username}"                              = ["DELETE"]
    "/admin/users/{username}/admin"                        = ["PUT", "DELETE"]
    "/admin/users/{username}/enabled"                      = ["PUT"]
    "/admin/metrics"                                       = ["GET"]
    "/admin/ai-settings"                                   = ["GET", "PUT"]
    "/admin/ai-settings/test"                              = ["POST"]
    "/push/subscription"                                   = ["POST", "DELETE"]
    "/me"                                                  = ["GET", "DELETE"]
  }
  route_keys = toset(flatten([for path, methods in local.routes : [for m in methods : "${m} ${path}"]]))
}

resource "aws_apigatewayv2_route" "private" {
  for_each           = local.route_keys
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

# Shared car pages are public: no authorizer.
resource "aws_apigatewayv2_route" "public_car" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /public/cars/{carId}"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_rate_limit  = 20
    throttling_burst_limit = 40
  }
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}
