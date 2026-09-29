# PHP (Laravel) and Ruby (Rails)

## PHP / Laravel
**Detect:** `composer.json`, `artisan`. **Commands:** `composer install` · `php artisan test` (or `vendor/bin/pest`/`phpunit`) · `vendor/bin/pint --test` · `vendor/bin/phpstan analyse` if configured.
- `declare(strict_types=1)`; typed properties/returns; PSR-12 style.
- Form Requests for validation; Policies/Gates for authorization on every controller action; mass-assignment protection (`$fillable`), never `$guarded = []` on user-facing models.
- Eloquent: eager-load (`with()`) to avoid N+1; migrations for every schema change; DB transactions for multi-writes; queues/jobs idempotent.
- Blade escapes by default (`{{ }}`) — avoid `{!! !!}` with user data; CSRF on forms; config via `.env` + `config()` (never `env()` outside config files).

## Ruby / Rails
**Detect:** `Gemfile`, `config/application.rb`. **Commands:** `bundle install` · `bin/rails test` or `bundle exec rspec` · `bundle exec rubocop` · `bin/rails db:migrate` (dev/test only).
- Strong parameters for every create/update; authorization (Pundit/CanCanCan or explicit checks) on every action.
- Models: validations + DB constraints; `includes`/`preload` for N+1; scopes for reusable queries; callbacks sparingly.
- Background jobs (ActiveJob/Sidekiq) idempotent with retries; credentials via `rails credentials`/env.
- Views escape by default; avoid `html_safe`/`raw` on user content.

## Review focus
Authorization per action, validation, N+1, migration safety, escaping.
