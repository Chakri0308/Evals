.PHONY: install dev prod build test lint typecheck check clean

BE := backend
FE := frontend
PY := $(shell [ -f $(BE)/.venv/bin/python ] && echo $(BE)/.venv/bin/python || echo $(BE)/.venv/Scripts/python)

install:            ## create the venv (CPU torch) and install backend + frontend deps
	python3 -m venv $(BE)/.venv
	$(PY) -m pip install torch --index-url https://download.pytorch.org/whl/cpu
	$(PY) -m pip install -r $(BE)/requirements-dev.txt
	cd $(FE) && npm install

dev:                ## API (auto-reload) on :8765 + Vite UI on :5173
	./dev.sh

build:              ## production UI bundle → frontend/dist
	cd $(FE) && npm run build

prod: build         ## UI + API from one process on :8765
	./prod.sh

test:               ## backend test suite
	cd $(BE) && $(abspath $(PY)) -m pytest

lint:               ## ruff (backend) + oxlint (frontend)
	cd $(BE) && $(abspath $(PY)) -m ruff check app tests
	cd $(FE) && npm run lint

typecheck:
	cd $(FE) && npm run typecheck

check: lint typecheck test   ## everything CI should run

clean:
	rm -rf $(FE)/dist $(BE)/.pytest_cache $(BE)/.ruff_cache
	find $(BE) -name __pycache__ -type d -prune -exec rm -rf {} +
