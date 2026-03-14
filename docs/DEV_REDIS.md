Developer note — In-memory Redis stub and local Redis setup

This project includes a lightweight in-memory Redis-compatible stub used when no real Redis instance is configured or reachable. The stub is intentionally minimal and intended for single-process development only.

When the code falls back to the in-memory stub you will see a log message similar to:

[redis] no Redis configured; using in-memory stub

Limitations of the in-memory stub
- Single-process only: it does not provide cross-process pub/sub, shared cache or distributed locks. Running multiple shards or separate worker processes will not coordinate correctly.
- No persistence: data is lost when the process exits.
- Reduced feature parity: advanced Redis features used in production (BullMQ jobs, delayed jobs, visibility timeouts) are not fully supported.
- No performance equivalence: the in-memory stub is not optimized for high-throughput scenarios.

When to use the in-memory stub
- Local development when you only run a single process (quick tests, unit tests, or light development without workers).
- CI or test environments where isolation and speed are more important than cross-process coordination.

How to enable a real Redis quickly (recommended for development)
- Use a remote Redis and set `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` in your environment.
  Example:

  REDIS_URL="redis://:mypassword@redis.example.com:6379"

- Install Redis locally on macOS (Homebrew):

  brew install redis
  brew services start redis
  redis-cli ping   # should return PONG

- If you have Docker available, use the provided helper or run:
 - If you have Docker available, use the provided helper or run:

   docker run -p 6379:6379 --name xeno-redis -d redis:7-alpine

Platform-specific install notes

- macOS (recommended for local dev)

  - Install Homebrew (if needed):

    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  - Install and start Redis:

    brew install redis
    brew services start redis

  - Verify:

    redis-cli ping

- Linux (Debian/Ubuntu):

  ```bash
  sudo apt update
  sudo apt install redis-server
  sudo systemctl enable --now redis-server
  redis-cli ping
  ```

- Windows:

  - Use WSL and follow the Linux steps inside WSL, or run Redis in Docker as shown above.


Project behavior and env vars
- The project respects these environment variables:
  - `REDIS_URL` — full connection URL (overrides host/port/password)
  - `REDIS_HOST` — host (default: `127.0.0.1`)
  - `REDIS_PORT` — port (default: `6379`)
  - `REDIS_PASSWORD` — password (optional)
  - `AUTO_START_REDIS` — when set to `1`, the project will attempt to auto-start Redis for development (Docker or local `redis-server` binary)
  - `REDIS_REQUIRED` — when set, startup will fail if Redis is not reachable

If you need me to validate a `REDIS_URL` from here, paste a redacted value (keep the host and port, redact the password) and I can run a connectivity check for you.
