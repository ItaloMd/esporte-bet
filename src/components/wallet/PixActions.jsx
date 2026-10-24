import React from "react";
import { Link } from "react-router-dom";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PixActions() {
  return (
    <section className="card-surface flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-sm font-semibold">Depósito e saque via PIX</h2>
        <p className="text-xs text-muted-foreground">
          Deposite na hora com PIX e solicite seu saque quando quiser.
        </p>
      </div>
      <div className="flex gap-2">
        <Button asChild>
          <Link to="/carteira?acao=deposito">
            <ArrowDownToLine className="mr-2 h-4 w-4" aria-hidden="true" /> Depositar
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/carteira?acao=saque">
            <ArrowUpFromLine className="mr-2 h-4 w-4" aria-hidden="true" /> Sacar
          </Link>
        </Button>
      </div>
    </section>
  );
}