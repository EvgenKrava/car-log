import DocumentScannerIcon from '@mui/icons-material/DocumentScanner';
import TextSnippetIcon from '@mui/icons-material/TextSnippet';
import EditNoteIcon from '@mui/icons-material/EditNote';
import { useTranslation } from 'react-i18next';
import { OptionSheet } from './ui/OptionSheet';

// The vehicle FAB's "add to history" options. A list-in-a-sheet rather than a
// dropdown menu, so the option set can grow richly — add entries to the
// `options` array below and they render automatically.
export function AddRecordSheet({
  open, onClose, onScan, onImport, onManual,
}: {
  open: boolean;
  onClose: () => void;
  onScan: () => void;
  onImport: () => void;
  onManual: () => void;
}) {
  const { t } = useTranslation(['event']);
  return (
    <OptionSheet
      open={open}
      onClose={onClose}
      title={t('event:addRecordTitle')}
      options={[
        { key: 'scan', icon: DocumentScannerIcon, label: t('event:addScan'), onSelect: onScan },
        { key: 'import', icon: TextSnippetIcon, label: t('event:addBulk'), onSelect: onImport },
        { key: 'manual', icon: EditNoteIcon, label: t('event:addManual'), onSelect: onManual },
      ]}
    />
  );
}
