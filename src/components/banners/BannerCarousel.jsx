import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Image } from "@/components/ui/image";
import { cn } from "@/lib/utils";

const AUTOPLAY_MS = 6000;

export default function BannerCarousel() {
  const navigate = useNavigate();
  const trackRef = useRef(null);
  const [banners, setBanners] = useState([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    base44.entities.Banner.filter({ active: true }, { sort: "sort_order", limit: 12 })
      .then((page) => {
        if (!alive) return;
        setBanners(page.items || []);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const goTo = useCallback(
    (next) => {
      const track = trackRef.current;
      const count = banners.length;
      if (!track || !count) return;
      const target = ((next % count) + count) % count;
      track.scrollTo({ left: target * track.clientWidth, behavior: "smooth" });
      setIndex(target);
    },
    [banners.length],
  );

  useEffect(() => {
    if (banners.length < 2) return;
    const timer = setTimeout(() => goTo(index + 1), AUTOPLAY_MS);
    return () => clearTimeout(timer);
  }, [banners.length, index, goTo]);

  const handleScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    const next = Math.round(track.scrollLeft / track.clientWidth);
    if (next !== index) setIndex(next);
  };

  const openBanner = (banner) => {
    if (!banner.link_url) return;
    if (/^https?:\/\//i.test(banner.link_url)) window.location.href = banner.link_url;
    else navigate(banner.link_url);
  };

  if (loading) return <div className="h-44 w-full animate-pulse rounded-xl bg-secondary sm:h-60 md:h-72" />;
  if (!banners.length) return null;

  return (
    <section className="relative">
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="hide-scrollbar flex snap-x snap-mandatory overflow-x-auto rounded-xl"
      >
        {banners.map((banner) => (
          <button
            key={banner.id}
            type="button"
            onClick={() => openBanner(banner)}
            aria-label={banner.title || "Banner promocional"}
            className={cn(
              "relative w-full shrink-0 snap-center overflow-hidden rounded-xl border border-border bg-secondary/40",
              banner.link_url ? "cursor-pointer" : "cursor-default",
            )}
          >
            <Image
              src={banner.image_url}
              alt={banner.title || "Banner promocional"}
              fittingType="fit"
              className="h-44 w-full sm:h-60 md:h-72"
            />
          </button>
        ))}
      </div>

      {banners.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            aria-label="Banner anterior"
            className="absolute left-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-border bg-background/80 text-foreground backdrop-blur transition-colors hover:border-primary/60 sm:grid"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            aria-label="Próximo banner"
            className="absolute right-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-border bg-background/80 text-foreground backdrop-blur transition-colors hover:border-primary/60 sm:grid"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="mt-2 flex justify-center gap-1.5">
            {banners.map((banner, position) => (
              <button
                key={banner.id}
                type="button"
                onClick={() => goTo(position)}
                aria-label={`Ir para o banner ${position + 1}`}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  position === index ? "w-5 bg-primary" : "w-1.5 bg-border",
                )}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}