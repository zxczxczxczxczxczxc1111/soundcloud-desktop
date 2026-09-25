/**
 * Utility for extracting colors from CSS theme files
 * Parses CSS custom properties and returns a structured color palette
 */

export interface ThemeColors {
    primary: string;
    secondary: string;
    background: string;
    surface: string;
    text: string;
    accent: string;
}

/**
 * Extract color values from CSS content
 * Looks for common CSS variable patterns used in themes
 */
export function extractThemeColors(cssContent: string): ThemeColors | null {
    if (!cssContent || cssContent.trim() === '') {
        return null;
    }

    const colors: Partial<ThemeColors> = {};

    // Helper to parse CSS color values (hex, rgb, rgba, hsl, hsla)
    const parseColorValue = (value: string): string | null => {
        if (!value) return null;

        // Clean up the value
        value = value
            .trim()
            .replace(/!important/gi, '')
            .trim();

        // Handle hex colors
        if (value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)) {
            return value;
        }

        // Палитра также попадает в HTML уведомлений: допускается только синтаксис цвета.
        if (value.match(/^(?:rgba?|hsla?)\(\s*(?:[-+\d.%\s,/]|deg|grad|rad|turn)+\)$/i)) {
            return value;
        }

        // Handle named colors
        if (value.match(/^[a-z]+$/i)) {
            return value;
        }

        return null;
    };

    // Extract CSS variables from the content
    const extractVariable = (varName: string): string | null => {
        // Match --varName: value; or --varName: value !important;
        const regex = new RegExp(`--${varName}\\s*:\\s*([^;]+);`, 'i');
        const match = cssContent.match(regex);
        if (match && match[1]) {
            return parseColorValue(match[1]);
        }
        return null;
    };

    // Priority order for extracting colors
    // Try to find the most common variable names used in themes

    // Primary color (for accents, buttons, highlights)
    colors.primary =
        extractVariable('primary-color') ||
        extractVariable('button-primary-background-color') ||
        extractVariable('accent-color') ||
        extractVariable('highlight-color') ||
        extractVariable('artist-color') ||
        '#ff5500'; // SoundCloud orange fallback

    // Secondary color
    colors.secondary =
        extractVariable('secondary-color') ||
        extractVariable('button-secondary-background-color') ||
        extractVariable('artist-surface-color') ||
        '#a89984'; // Gruvbox secondary fallback

    // Background color
    colors.background =
        extractVariable('background-surface-color') ||
        extractVariable('surface-color') ||
        extractVariable('background-dark-color') ||
        extractVariable('background-base') ||
        '#1d2021'; // Gruvbox background fallback

    // Surface color (for cards, panels)
    colors.surface =
        extractVariable('surface-color') ||
        extractVariable('background-highlight-color') ||
        extractVariable('background-surface') ||
        '#282828'; // Gruvbox surface fallback

    // Text color
    colors.text =
        extractVariable('primary-color') ||
        extractVariable('font-primary-color') ||
        extractVariable('font-light-color') ||
        extractVariable('text-base') ||
        '#ebdbb2'; // Gruvbox text fallback

    // Accent color (for special elements)
    colors.accent =
        extractVariable('button-special-background-color') ||
        extractVariable('font-special-color') ||
        extractVariable('special-color') ||
        extractVariable('artist-pro-color') ||
        '#fe8019'; // Gruvbox accent fallback

    return colors as ThemeColors;
}
