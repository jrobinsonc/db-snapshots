## 2025-02-14 - Exposing Database Passwords in Process Arguments
**Vulnerability:** MySQL passwords were passed directly via command line arguments (`-p<password>`), making them visible in system process lists (`ps aux`).
**Learning:** External process execution often exposes arguments. Passing secrets via command flags is insecure.
**Prevention:** Use environment variables (like `MYSQL_PWD`) to pass sensitive credentials securely without exposing them in the process list.
