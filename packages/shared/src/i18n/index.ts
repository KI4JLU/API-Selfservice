import de from './de.json' with { type: 'json' };
import en from './en.json' with { type: 'json' };

export const resources = { de: { translation: de }, en: { translation: en } } as const;
export { de, en };
