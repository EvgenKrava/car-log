import DirectionsCarFilledOutlinedIcon from '@mui/icons-material/DirectionsCarFilledOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import { useTranslation } from 'react-i18next';
import { OptionSheet } from './ui/OptionSheet';

// The garage FAB's options: start a car from scratch, or recreate one from a
// CarLog export file (POST /import/car).
export function AddCarSheet({
  open, onClose, onCreate, onImport,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: () => void;
  onImport: () => void;
}) {
  const { t } = useTranslation(['garage']);
  return (
    <OptionSheet
      open={open}
      onClose={onClose}
      title={t('garage:addSheetTitle')}
      options={[
        { key: 'create', icon: DirectionsCarFilledOutlinedIcon, label: t('garage:addCar'), onSelect: onCreate },
        { key: 'import', icon: UploadFileOutlinedIcon, label: t('garage:importCar'), onSelect: onImport },
      ]}
    />
  );
}
