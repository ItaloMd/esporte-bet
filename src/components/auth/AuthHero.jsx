import React from "react";
import { Link } from "react-router-dom";
import { BarChart3, ScanLine, ShieldCheck } from "lucide-react";
import { Image } from "@/components/ui/image";
import BrandMark from "@/components/brand/BrandMark";

const HERO_IMAGE =
  "https://media.base44.com/images/public/6adbd8eed1acc60fb890bd2a/a52f44dd8_generated_image.png";

const HIGHLIGHTS = [
  { icon: BarChart3, text: "Estatísticas e histórico de cada partida: gols, escanteios e cartões." },
  { icon: ScanLine, text: "Mercados pré-jogo com cotações de referência conferidas antes do apito." },
  { icon: ShieldCheck, text: "Resultados auditados e bilhetes liquidados automaticamente." },
];

/** Painel de identidade das telas de acesso: gramado noturno, marca e destaques. */
export default function AuthHero({ brandName, tagline }) {
  return (
    <aside className="relative isolate overflow-hidden border-b border-border/60 lg:border-b-0 lg:border-r lg:border-border/60">
      <Image
        src={HERO_IMAGE}
        alt=""
        fittingType="fill"
        className="absolute inset-0 h-full w-full opacity-70"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background/95 via-background/80 to-background lg:bg-gradient-to-tr lg:from-background/95 lg:via-background/75 lg:to-background/40" />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 opacity-30"
        style={{
          backgroundImage:
            "repeating-linear-gradient(115deg, hsl(var(--primary) / 0.35) 0 2px, transparent 2px 26px)",
        }}
        aria-hidden="true"
      />

      <div className="relative flex h-full flex-col gap-7 px-6 py-8 lg:justify-between lg:px-12 lg:py-14">
        <Link to="/" className="flex items-center gap-2.5" aria-label={brandName}>
          <BrandMark className="h-9 w-9" />
          <span className="font-display text-xl font-bold uppercase tracking-tight">{brandName}</span>
        </Link>

        <div className="max-w-md">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
            Futebol · pré-jogo
          </span>
          <h1 className="mt-4 font-display text-3xl font-bold uppercase leading-[1.05] tracking-tight sm:text-4xl lg:text-5xl">
            Palpite com<br />
            <span className="text-primary">estatística</span> no pé
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {tagline || "Odds, histórico e resultados das principais competições de futebol em um só lugar."}
          </p>

          <ul className="mt-6 hidden space-y-3 lg:block">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2.5 text-xs leading-relaxed text-muted-foreground">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="hidden text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70 lg:block">
          +18 anos · jogue com responsabilidade
        </p>
      </div>
    </aside>
  );
}