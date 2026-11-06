import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import BrandMark from '@/components/brand/BrandMark';
import { useAppSettings } from '@/lib/appSettings';


export default function PageNotFound({}) {
    const location = useLocation();
    const pageName = location.pathname.substring(1);
    const settings = useAppSettings();

    useEffect(() => {
        const meta = document.createElement('meta');
        meta.name = 'prerender-status-code';
        meta.content = '404';
        document.head.appendChild(meta);
        return () => {
            document.head.removeChild(meta);
        };
    }, []);

    const { data: authData, isFetched } = useQuery({
        queryKey: ['user'],
        queryFn: async () => {
            try {
                const user = await base44.auth.me();
                return { user, isAuthenticated: true };
            } catch (error) {
                return { user: null, isAuthenticated: false };
            }
        }
    });

    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
            <div className="w-full max-w-md">
                <div className="panel p-7 text-center">
                    <div className="mb-6 flex items-center justify-center gap-2">
                        <BrandMark className="h-8 w-8" />
                        <span className="font-display text-lg font-bold uppercase tracking-tight">{settings.brand_name}</span>
                    </div>

                    <p className="score-num text-6xl font-bold leading-none text-primary">404</p>
                    <h1 className="mt-3 font-display text-2xl font-bold uppercase tracking-tight">Página não encontrada</h1>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        O endereço {pageName ? <span className="font-medium text-foreground">“/{pageName}”</span> : 'acessado'} não existe nesta plataforma.
                    </p>

                    {isFetched && authData?.isAuthenticated && authData.user?.role === 'admin' && (
                        <div className="mt-5 rounded-md border border-border bg-secondary/40 p-3 text-left">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nota do admin</p>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                Esta página ainda não foi construída. Peça a implementação pelo chat.
                            </p>
                        </div>
                    )}

                    <Link
                        to="/"
                        className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
                    >
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        Voltar ao início
                    </Link>
                </div>
            </div>
        </div>
    )
}