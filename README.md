
## Project setup

```bash
$ pnpm install
```
### Start Database

```bash
docker-compose up -d
```

### Run Migrations

```bash
pnpm db:migrate
```

### Seed Data (optional)

```bash
pnpm db:seed
```
## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```
See [docs/HW5.md](docs/HW5.md) for details.
