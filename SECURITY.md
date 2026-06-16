# Security Policy

Sana handles financial records inside a Telegram Mini App, so security reports
are taken seriously.

## Supported versions

The `main` branch is the only actively maintained version.

## Reporting a vulnerability

If you find a vulnerability, please do not open a public issue with exploit
details. Contact the maintainer privately through the contact link on the
GitHub profile or the Telegram contact listed in the project README.

Please include:

- A short description of the issue
- Steps to reproduce it
- Affected files or endpoints, if known
- Any suggested fix or mitigation

## Security focus areas

Reports are especially helpful around:

- Telegram Mini App authentication
- HMAC validation of Telegram `initData`
- API authorization and user isolation
- Database migrations and data integrity
- Secret handling in Docker and deployment workflows
