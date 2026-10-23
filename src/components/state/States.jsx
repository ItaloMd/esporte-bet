import React from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyState({ title, description, action }) {
  return (
    <div className="card-surface flex flex-col items-center gap-2 px-6 py-10 text-center">
      <Inbox className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="card-surface flex flex-col items-center gap-3 px-6 py-10 text-center">
      <AlertTriangle className="h-7 w-7 text-destructive" aria-hidden="true" />
      <p className="font-medium">Não foi possível carregar os dados agora</p>
      <p className="max-w-md text-sm text-muted-foreground">{message || "Tente novamente em alguns instantes."}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}