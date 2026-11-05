# Dabbawala Protocol — Developer Makefile
# Targets fail explicitly and propagate errors.
# Run `make help` for a full list.

.PHONY: help install build dev lint typecheck test test-all clean \
        db-start db-stop db-migrate db-seed \
        anvil forge-build forge-test \
        circuits-compile circuits-test \
        security-slither security-aderyn ci-all

SHELL := /bin/bash
.DEFAULT_GOAL := help

help: ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-28s\033[0m %s\n", $$1, $$2}'

# ── Workspace ────────────────────────────────────────────────────────────────

install: ## Install all workspace dependencies (frozen lockfile)
	pnpm install --frozen-lockfile

build: ## Build all workspace packages
	pnpm build

dev: ## Start all services in dev/watch mode
	pnpm dev

lint: ## Run ESLint across all packages
	pnpm lint

typecheck: ## Run TypeScript type checks across all packages
	pnpm typecheck

test: ## Run unit tests across all packages
	pnpm test

test-all: ## Run the full test suite (pnpm test:all)
	pnpm test:all

clean: ## Remove build artifacts and dependency caches
	pnpm clean

# ── Database ─────────────────────────────────────────────────────────────────

db-start: ## Start PostgreSQL via Docker Compose
	docker compose up -d postgres
	@echo "Waiting for PostgreSQL to be healthy..."
	@docker compose exec postgres pg_isready -U dabbawala -d dabbawala_dev || sleep 5

db-stop: ## Stop PostgreSQL container
	docker compose stop postgres

db-migrate: ## Run database migrations
	pnpm db:migrate

db-seed: ## Seed the development database
	pnpm db:seed

# ── Local EVM (Anvil) ────────────────────────────────────────────────────────

anvil: ## Start a local Anvil EVM node (chain id 31337, port 8545)
	anvil --chain-id 31337 --port 8545 --block-time 2

# ── Smart Contracts (Foundry) ─────────────────────────────────────────────────

forge-build: ## Compile smart contracts with Forge
	cd contracts && forge build

forge-test: ## Run Foundry tests
	cd contracts && forge test -vvv

forge-coverage: ## Run Foundry tests with coverage
	cd contracts && forge coverage

# ── Circuits (Circom / snarkjs) ───────────────────────────────────────────────

circuits-compile: ## Compile Circom circuits
	cd circuits && bash scripts/compile.sh

circuits-test: ## Run circuit test vectors
	cd circuits && bash scripts/test.sh

# ── Security ─────────────────────────────────────────────────────────────────

security-slither: ## Run Slither static analysis on contracts
	cd contracts && slither . --json ../slither-report.json || true
	@echo "Slither report: slither-report.json"

security-aderyn: ## Run Aderyn on contracts
	cd contracts && aderyn . --output ../aderyn-report.json || true
	@echo "Aderyn report: aderyn-report.json"

# ── CI ────────────────────────────────────────────────────────────────────────

ci-all: lint typecheck test-all forge-test ## Run all CI checks locally (requires all tools installed)
	@echo "All CI checks passed."

