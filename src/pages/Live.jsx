import React, { useEffect } from "react";
import { Radio, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import EventGrid from "@/components/odds/EventGrid";
import DemoNotice from "@/components/state/DemoNotice";
import useEventFeed from "@/lib/useEventFeed";
import { timeAgo } from "@/lib/format";
import { useAppSettings } from "@/lib/appSettings";

const LIVE_FILTER = { status: "live" };
const REFRESH_MS = 60000;

export default function Live() {
  const settings = useAppSettings();
  const feed = useEventFeed(LIVE_FILTER, { limit: 20 });
  const [lastRefresh, setLastRefresh] = React.useState(new Date().toISOString());

  useEffect(() => {
    const timer = setInterval(() => {
      feed.reload();
      setLastRefresh(new Date().toISOString());
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [feed.reload]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl border border-destructive/40 bg-destructive/10">
            <Radio className="h-5 w-5 text-destructive" />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Partidas ao vivo</h1>
            <p className="text-xs text-muted-foreground">
              Atualização automática a cada 60 segundos · última consulta {timeAgo(lastRefresh)}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            feed.reload();
            setLastRefresh(new Date().toISOString());
          }}
          disabled={feed.loading}
        >
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${feed.loading ? "animate-spin" : ""}`} />
          Atualizar agora
        </Button>
      </header>

      {settings.demo_mode && (
        <DemoNotice>
          Modo demonstrativo: os placares ao vivo exibidos são dados de simulação, identificados como tal. Nenhuma
          aposta com dinheiro real é possível.
        </DemoNotice>
      )}

      <EventGrid
        events={feed.events}
        oddsByEvent={feed.oddsByEvent}
        loading={feed.loading}
        error={feed.error}
        onRetry={feed.reload}
        emptyTitle="Nenhuma partida ao vivo agora"
        emptyDescription="Quando a fonte de dados informar eventos em andamento, eles aparecem nesta página automaticamente."
      />
    </div>
  );
}