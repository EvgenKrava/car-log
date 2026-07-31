import { ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';
import DocumentScannerIcon from '@mui/icons-material/DocumentScanner';
import TextSnippetIcon from '@mui/icons-material/TextSnippet';
import EditNoteIcon from '@mui/icons-material/EditNote';
import { useTranslation } from 'react-i18next';

// The three ways to add a service record — scan a document, bulk-import text, or
// enter manually. Shared by the timeline header button and the vehicle FAB so both
// entry points offer the identical menu.
export function AddRecordMenu({
  anchorEl, onClose, onScan, onImport, onManual,
}: {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onScan: () => void;
  onImport: () => void;
  onManual: () => void;
}) {
  const { t } = useTranslation(['event']);
  const pick = (fn: () => void) => () => { onClose(); fn(); };
  return (
    <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={onClose}>
      <MenuItem onClick={pick(onScan)}>
        <ListItemIcon><DocumentScannerIcon fontSize="small" /></ListItemIcon>
        <ListItemText>{t('event:addScan')}</ListItemText>
      </MenuItem>
      <MenuItem onClick={pick(onImport)}>
        <ListItemIcon><TextSnippetIcon fontSize="small" /></ListItemIcon>
        <ListItemText>{t('event:addBulk')}</ListItemText>
      </MenuItem>
      <MenuItem onClick={pick(onManual)}>
        <ListItemIcon><EditNoteIcon fontSize="small" /></ListItemIcon>
        <ListItemText>{t('event:addManual')}</ListItemText>
      </MenuItem>
    </Menu>
  );
}