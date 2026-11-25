import {Component, type ErrorInfo, type ReactNode} from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Ocurrió un error inesperado.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      let friendly =
        'Ocurrió un problema de conexión o permisos con la base de datos en la nube.';
      if (this.state.message.includes('Quota exceeded')) {
        friendly =
          'Se alcanzó el límite diario gratuito de lecturas/escrituras de la base de datos. Intenta mañana o actualiza el plan en Firebase.';
      }

      return (
        <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-6">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-base font-bold text-slate-900">
              Mapa Campus ITD — Aviso de sincronización
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              {friendly}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 w-full rounded-xl bg-[#6F1D3A] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#58162d]"
            >
              Recargar aplicación
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
