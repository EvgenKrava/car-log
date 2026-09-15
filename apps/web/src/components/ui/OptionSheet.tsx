import { List, ListItemButton, ListItemIcon, ListItemText } from '@mui/material';
import type { SvgIconComponent } from '@mui/icons-material';
import { Modal } from './Modal';

export type SheetOption = { key: string; icon: SvgIconComponent; label: string; onSelect: () => void };

// A titled list of actions in a modal (a bottom sheet on phones) — the iOS
// "what do you want to add?" pattern shared by the garage and vehicle "+"
// buttons. Picking an option closes the sheet before running it, so the
// follow-up dialog never stacks on top of this one.
export function OptionSheet({
  open, onClose, title, options,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  options: SheetOption[];
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="xs" contentSx={{ p: 0 }}>
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
