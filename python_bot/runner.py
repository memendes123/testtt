"""Utilities to start the live monitor and owner command together."""
from __future__ import annotations

import argparse
import logging
import signal
import sys
import threading
from pathlib import Path
from typing import Optional

from .config import load_settings
from .live_monitor import LiveMonitor
from .owner_command import listen_for_owner_commands
from .competitions import load_index


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inicia os serviços do bot em conjunto")
    parser.add_argument("start", nargs="?", help=argparse.SUPPRESS)
    parser.add_argument("--env", help="Caminho para o ficheiro .env", default=None)
    parser.add_argument("--chat-id", help="Chat ID opcional para alertas", default=None)
    parser.add_argument(
        "--interval",
        type=int,
        default=180,
        help="Intervalo (s) entre ciclos do monitor ao vivo (mínimo 30s)",
    )
    parser.add_argument(
        "--min-confidence",
        choices=("low", "medium", "high"),
        default="medium",
        help="Confiança mínima para alertas ao vivo",
    )
    parser.add_argument(
        "--owner-poll-interval",
        type=int,
        default=5,
        help="Pausa (s) entre novas tentativas do listener do owner",
    )
    parser.add_argument(
        "--restart-delay",
        type=int,
        default=15,
        help="Tempo (s) antes de reiniciar um serviço que caiu",
    )
    parser.add_argument("--no-live", action="store_true", help="Não iniciar o monitor ao vivo")
    parser.add_argument(
        "--no-owner",
        action="store_true",
        help="Não iniciar o listener de comandos do owner",
    )
    parser.add_argument("--dry-run", action="store_true", help="Não enviar alertas ao Telegram")
    parser.add_argument("--verbose", action="store_true", help="Ativa logs detalhados")
    return parser.parse_args(argv)


def _ensure_command(args: argparse.Namespace) -> None:
    if args.start not in (None, "start"):
        raise SystemExit("Comando desconhecido. Utilize: python -m python_bot.runner start [opções]")
    args.command = "start"


def _configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def _launch_live_monitor(
    settings,
    index,
    *,
    args: argparse.Namespace,
    stop_event: threading.Event,
) -> None:
    logger = logging.getLogger("python-bot.live-monitor")
    while not stop_event.is_set():
        monitor = LiveMonitor(
            settings,
            index,
            chat_id=args.chat_id,
            interval=args.interval,
            min_confidence=args.min_confidence,
            dry_run=args.dry_run,
            logger=logger,
            stop_event=stop_event,
        )
        try:
            monitor.run()
        except Exception:  # noqa: BLE001
            logger.exception(
                "Monitor ao vivo terminou com erro. A reiniciar em %ss", args.restart_delay
            )
            if stop_event.wait(max(1, args.restart_delay)):
                break
        else:
            break


def _launch_owner_listener(
    settings,
    index,
    *,
    args: argparse.Namespace,
    stop_event: threading.Event,
) -> None:
    logger = logging.getLogger("owner-command")
    while not stop_event.is_set():
        try:
            listen_for_owner_commands(
                settings,
                index=index,
                poll_interval=args.owner_poll_interval,
                logger=logger,
                stop_event=stop_event,
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "Listener do owner terminou com erro. A reiniciar em %ss", args.restart_delay
            )
            if stop_event.wait(max(1, args.restart_delay)):
                break
        else:
            break


def start_services(args: argparse.Namespace) -> int:
    if args.no_live and args.no_owner:
        logging.getLogger("python-bot.runner").error(
            "Nenhum serviço selecionado. Desative apenas um entre --no-live ou --no-owner."
        )
        return 1

    try:
        settings = load_settings(Path(args.env) if args.env else None)
    except Exception as exc:  # noqa: BLE001
        logging.getLogger("python-bot.runner").error("Falha ao carregar configurações: %s", exc)
        return 1

    index = load_index()
    stop_event = threading.Event()
    threads: list[threading.Thread] = []

    if not args.no_live:
        live_thread = threading.Thread(
            target=_launch_live_monitor,
            args=(settings, index),
            kwargs={"args": args, "stop_event": stop_event},
            daemon=True,
        )
        threads.append(live_thread)
        live_thread.start()

    if not args.no_owner:
        owner_thread = threading.Thread(
            target=_launch_owner_listener,
            args=(settings, index),
            kwargs={"args": args, "stop_event": stop_event},
            daemon=True,
        )
        threads.append(owner_thread)
        owner_thread.start()

    if not threads:
        logging.getLogger("python-bot.runner").warning("Nenhum serviço foi iniciado")
        return 0

    def _handle_signal(signum, _frame):
        logging.getLogger("python-bot.runner").info(
            "Sinal %s recebido. Encerrando serviços...", signum
        )
        stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _handle_signal)
        except ValueError:
            # Não é possível registar sinal (por exemplo em threads secundárias)
            pass

    try:
        while any(thread.is_alive() for thread in threads):
            for thread in threads:
                thread.join(timeout=0.5)
            if stop_event.is_set():
                break
    except KeyboardInterrupt:
        logging.getLogger("python-bot.runner").info(
            "Interrupção manual recebida. A encerrar serviços..."
        )
        stop_event.set()
        for thread in threads:
            thread.join(timeout=1)

    return 0


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    _ensure_command(args)
    _configure_logging(args.verbose)
    return start_services(args)


if __name__ == "__main__":
    sys.exit(main())
