module.exports = {
  content: [ "./pages/**/*.{js,jsx}", "./components/**/*.{js,jsx}", "./lib-engine/**/*.{js,jsx}" ],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        auth: "var(--auth)",
        panel: "var(--panel)",
        surface: "var(--surface)",
        raised: "var(--raised)",
        hover: "var(--hover)",
        pressed: "var(--pressed)",
        line: "var(--line)",
        stroke: "var(--stroke)",
        fg: "var(--fg)",
        fg2: "var(--fg2)",
        fg3: "var(--fg3)",
        fg4: "var(--fg4)",
        accent: "var(--accent)",
        accentHover: "var(--accent-hover)",
        accentDim: "var(--accent-dim)",
        link: "var(--link)",
        error: "var(--error)",
        errorBg: "var(--error-bg)",
        errorBorder: "var(--error-border)",
        errorSurface: "var(--error-surface)",
        warning: "var(--warning)",
        warningBorder: "var(--warning-border)",
        warningSurface: "var(--warning-surface)",
        success: "var(--success)",
        successBorder: "var(--success-border)",
        successSurface: "var(--success-surface)"
      },
      boxShadow: {
        none: "none",
        sm: "none",
        DEFAULT: "none",
        md: "none",
        lg: "none",
        xl: "none",
        "2xl": "none",
        inner: "none",
        pop: "none"
      },
      keyframes: {
        glyphPulse: {
          "0%, 100%": {
            opacity: "0.35"
          },
          "50%": {
            opacity: "1"
          }
        },
        popIn: {
          from: {
            opacity: "0",
            transform: "translateY(-4px) scale(0.985)"
          },
          to: {
            opacity: "1",
            transform: "translateY(0) scale(1)"
          }
        },
        fadeIn: {
          from: {
            opacity: "0"
          },
          to: {
            opacity: "1"
          }
        },
        pageIn: {
          from: {
            opacity: "0",
            transform: "translateY(6px)"
          },
          to: {
            opacity: "1",
            transform: "translateY(0)"
          }
        }
      },
      animation: {
        glyphPulse: "glyphPulse 1.6s ease-in-out infinite",
        popIn: "popIn 110ms ease-out",
        fadeIn: "fadeIn 260ms ease-out",
        pageIn: "pageIn 200ms ease-out"
      }
    }
  },
  plugins: []
};
