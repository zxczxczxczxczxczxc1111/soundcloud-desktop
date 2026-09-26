import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        // *.helper.test.ts это помощники тестов: их импортируют, но сами по себе не запускают
        exclude: ['**/node_modules/**', '**/tsc/**', 'src/**/*.helper.test.ts'],
    },
});
