import { forwardRef, type ReactElement } from 'react';
import { List, ListItemButton, ListItemIcon, ListItemText, Slide } from '@mui/material';
import type { TransitionProps } from '@mui/material/transitions';
import DocumentScannerIcon from '@mui/icons-material/DocumentScanner';
import TextSnippetIcon from '@mui/icons-material/TextSnippet';
import EditNoteIcon from '@mui/icons-material/EditNote';
import type { SvgIconComponent } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { Modal } from './ui/Modal';

// Slide the sheet up from the bottom into place (on every breakpoint), reinforcing
// the bottom-sheet feel the mobile theme already gives.
const SlideUp = forwardRef(function SlideUp(
  props: TransitionProps & { children: ReactElement },
  ref: React.Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

type Option = { key: string; icon: SvgIconComponent; label: string; onSelect: () => void };

// The vehicle FAB's "add to history" options. A list-in-a-modal (bottom sheet on
// mobile) rather than a dropdown menu, so the option set can grow richly — add
// entries to the `options` array below and they render automatically.
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
  const options: Option[] = [
    { key: 'scan', icon: DocumentScannerIcon, label: t('event:addScan'), onSelect: onScan },
    { key: 'import', icon: TextSnippetIcon, label: t('event:addBulk'), onSelect: onImport },
    { key: 'manual', icon: EditNoteIcon, label: t('event:addManual'), onSelect: onManual },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('event:addRecordTitle')}
      maxWidth="xs"
      contentSx={{ p: 0 }}
      dialogProps={{ TransitionComponent: SlideUp }}
    >
      <List sx={{ py: 0 }}>
        {options.map(({ key, icon: Icon, label, onSelect }) => (
          <ListItemButton key={key} onClick={() => { onClose(); onSelect(); }} sx={{ py: 1.75 }}>
            <ListItemIcon sx={{ color: 'primary.main', minWidth: 44 }}><Icon /></ListItemIcon>
            <ListItemText primary={label} primaryTypographyProps={{ fontWeight: 600 }} />
          </ListItemButton>
        ))}
      </List>
    </Modal>
  );
}