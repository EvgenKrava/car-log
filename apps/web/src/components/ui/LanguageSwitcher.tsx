import { useState } from 'react';
import { Button, Menu, MenuItem } from '@mui/material';
import { useTranslation } from 'react-i18next';

const LANGS: { code: 'en' | 'uk'; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'uk', label: 'UK' },
];

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const current = i18n.language.startsWith('uk') ? 'UK' : 'EN';

  const pick = (code: 'en' | 'uk') => {
    void i18n.changeLanguage(code);
    document.documentElement.lang = code;
    setAnchor(null);
  };

  return (
    <>
      <Button color="inherit" onClick={(e) => setAnchor(e.currentTarget)}>{current}</Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {LANGS.map((l) => (
          <MenuItem key={l.code} selected={i18n.language.startsWith(l.code)} onClick={() => pick(l.code)}>
            {l.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
