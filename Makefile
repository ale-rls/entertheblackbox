.PHONY: up down logs ps test bed loadtest push status

up:            ## build + start the stack
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f --tail=100

ps:
	docker compose ps

test:          ## bridge unit tests (local venv)
	cd bridge && python -m pytest -q

bed:           ## (re)generate the default ambient bed with ffmpeg
	./scripts/make_default_bed.sh

loadtest:      ## N=100 BASE=http://localhost:8200 make loadtest
	./scripts/loadtest.sh

push:          ## PLAYER=1 FILE=sample_1.mp3 make push
	./scripts/push.sh $(or $(PLAYER),1) $(or $(FILE),sample_1.mp3) $(or $(MODE),interrupt)

status:
	curl -s $(or $(BRIDGE),http://localhost:8300)/status | python3 -m json.tool
