import React from "react";
import { Play } from "lucide-react";
import { Image } from "@/components/ui/image";
import { CATEGORY_LABEL, gameInitials } from "@/lib/gaming";

export default function GameCard({ game }) {
  const launchable = Boolean(game.launch_url);

  const open = () => {
    if (!launchable) return;
    window.open(game.launch_url, "_blank", "noopener,noreferrer");
  };

  return (
    <article className="group overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary/60">
      <div className="relative aspect-[4/3] overflow-hidden bg-secondary">
        {game.image_url ? (
          <Image
            src={game.image_url}
            alt={game.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="grid h-full w-full place-items-center bg-gradient-to-br from-secondary to-background">
            <span className="score-num text-2xl font-semibold text-primary/70">{gameInitials(game.name)}</span>
          </div>
        )}
        <button
          type="button"
          onClick={open}
          disabled={!launchable}
          aria-label={launchable ? `Jogar ${game.name}` : `${game.name} indisponível`}
          className="absolute inset-0 grid place-items-center bg-background/70 opacity-0 transition-opacity duration-200 group-hover:opacity-100 disabled:cursor-not-allowed disabled:group-hover:opacity-100 disabled:opacity-100"
        >
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
              launchable ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
            }`}
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            {launchable ? "Jogar" : "Conexão pendente"}
          </span>
        </button>
      </div>
      <div className="px-2.5 py-2">
        <p className="truncate text-sm font-medium leading-tight">{game.name}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {game.provider_name}
          {game.category ? ` · ${CATEGORY_LABEL[game.category] || game.category}` : ""}
        </p>
      </div>
    </article>
  );
}