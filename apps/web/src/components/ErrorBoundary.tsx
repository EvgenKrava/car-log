import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { StatusCard } from './StatusCard';

type Props = { t: TFunction; children: ReactNode };
type State = { failed: boolean };

// React 18 has no hook equivalent for error boundaries — this must stay a class. The
// translator is injected by the function wrapper below so the fallback stays localized.
class ErrorBoundaryInner extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const { t } = this.props;
    return (
      <StatusCard title={t('common:errorTitle')} body={t('common:errorBody')}
        primaryLabel={t('common:reload')} onPrimary={() => window.location.reload()}
        secondaryLabel={t('common:backToGarage')} secondaryHref="/" />
    );
  }
}

export function ErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation(['common']);
  return <ErrorBoundaryInner t={t}>{children}</ErrorBoundaryInner>;
}
