from __future__ import annotations

import argparse
import logging
import time
from datetime import date as date_cls
from datetime import datetime, time as time_cls, timedelta
from typing import List, Optional

try:  # Python 3.9+
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - fallback for environments without zoneinfo
    ZoneInfo = None  # type: ignore

from .main import main as run_once


def _parse_time(value: str) -> time_cls:
    try:
        parts = value.split(":")
        if len(parts) not in {2, 3}:
            raise ValueError
        hour = int(parts[0])
        minute = int(parts[1])
        second = int(parts[2]) if len(parts) == 3 else 0
        return time_cls(hour=hour, minute=minute, second=second)
    except ValueError as exc:  # noqa: BLE001
        raise argparse.ArgumentTypeError(
            "Formato inválido para horário. Utilize HH:MM ou HH:MM:SS"
        ) from exc


def _next_run(now: datetime, target: time_cls) -> datetime:
    candidate = now.replace(
        hour=target.hour,
        minute=target.minute,
        second=target.second,
        microsecond=0,
    )
    if candidate <= now:
        candidate += timedelta(days=1)
    return candidate


def _configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def _build_args(
    base_args: argparse.Namespace,
    run_date: date_cls,
) -> List[str]:
    argv: List[str] = ["--date", run_date.isoformat()]
    if base_args.env:
        argv.extend(["--env", base_args.env])
    if base_args.chat_id:
        argv.extend(["--chat-id", base_args.chat_id])
    if base_args.dry_run:
        argv.append("--dry-run")
    if base_args.verbose:
        argv.append("--verbose")
    return argv


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Agenda execuções diárias do bot de previsões")
    parser.add_argument("--env", help="Caminho para o arquivo .env", default=None)
    parser.add_argument("--chat-id", help="Chat id opcional para sobrescrever o destino", default=None)
    parser.add_argument(
        "--time",
        help="Horário diário no formato HH:MM (padrão 00:10)",
        default="00:10",
        type=_parse_time,
    )
    parser.add_argument(
        "--timezone",
        help="Timezone IANA para calcular o horário local (padrão UTC)",
        default="UTC",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Executa o bot em modo dry-run (não envia mensagem)",
    )
    parser.add_argument(
        "--run-immediately",
        action="store_true",
        help="Executa imediatamente antes de agendar o próximo ciclo",
    )
    parser.add_argument("--verbose", action="store_true", help="Ativa logs em nível debug")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    _configure_logging(args.verbose)
    logger = logging.getLogger("python-bot.scheduler")

    tz = None
    if ZoneInfo is not None:
        try:
            tz = ZoneInfo(args.timezone)
        except Exception as exc:  # noqa: BLE001
            logger.error("Timezone inválida: %s", args.timezone, exc_info=exc)
            return 1
    else:  # pragma: no cover - compatibilidade para Python < 3.9
        logger.warning("zoneinfo não disponível; utilizando horário local do sistema")

    def _now() -> datetime:
        current = datetime.now(tz) if tz else datetime.now()
        return current

    def _execute(run_dt: datetime) -> None:
        run_date = run_dt.date()
        bot_args = _build_args(args, run_date)
        logger.info("Executando bot para %s", run_date.isoformat())
        exit_code = run_once(bot_args)
        if exit_code != 0:
            logger.error("Execução retornou código %s", exit_code)

    if args.run_immediately:
        logger.info("Execução imediata solicitada")
        _execute(_now())

    while True:
        now = _now()
        target = _next_run(now, args.time)
        wait_seconds = max(1, int((target - now).total_seconds()))
        logger.info(
            "Próxima execução agendada para %s (em %.1f minutos)",
            target.isoformat(),
            wait_seconds / 60,
        )
        try:
            time.sleep(wait_seconds)
        except KeyboardInterrupt:  # pragma: no cover - interação manual
            logger.info("Scheduler interrompido pelo utilizador")
            return 0
        _execute(target)


if __name__ == "__main__":
    raise SystemExit(main())

