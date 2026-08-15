import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

/**
 * Preset Tailwind do Alloyal — o MESMO tema do alloyal-publi, copiado de propósito.
 *
 * É PRESET e não config: as duas aplicações do repositório (interna e portal do
 * cliente) usam o mesmo tema e declaram apenas o próprio `content`. Duas cópias
 * do tema divergiriam no primeiro ajuste de cor feito com pressa.
 *
 * Roxo #6A18E5 = ação; laranja #FF7A00 = marca/acento. Tokens semânticos shadcn
 * (via HSL em tokens.css) + paleta Alloyal crua.
 *
 * É cópia e não aproximação porque o objetivo é que quem abre o Pulse depois do
 * Publi não perceba que trocou de produto: mesmas classes, mesmos números,
 * mesmas sombras. Aproximar geraria dois roxos parecidos, que é pior que dois
 * roxos diferentes — ninguém sabe qual é o certo.
 *
 * Ao divergir de Publi, divergir aqui e anotar o porquê.
 */
export const alloyalPreset: Partial<Config> = {
  darkMode: ['class'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        // shadcn semânticos
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },

        // ┌─────────────────────────────────────────────────────────────┐
        // │ PALETA ALLOYAL, por VARIÁVEL e não por hex literal.           │
        // │                                                               │
        // │ Era hex aqui e variável no CSS ao mesmo tempo — e os dois não  │
        // │ se falavam: mudar `--surface` não mexia em `bg-surface`, que   │
        // │ já vinha compilado com `#FFFFFF`. O tema escuro do §02 não     │
        // │ tinha como funcionar.                                          │
        // │                                                               │
        // │ Agora a classe aponta para a variável, e o tema troca os       │
        // │ VALORES sem que nenhuma tela saiba em qual tema está — que é   │
        // │ exatamente a promessa de "o mesmo nome nos dois temas".        │
        // │                                                               │
        // │ Os degraus que o tema escuro NÃO redefine (purple 200/300/400/ │
        // │ 800/900, orange 100/300) seguem em hex: são decorativos e não  │
        // │ carregam texto, então não têm par escuro no documento.         │
        // └─────────────────────────────────────────────────────────────┘
        bg: 'var(--bg)',
        surface: { DEFAULT: 'var(--surface)', 2: 'var(--surface-2)' },
        line: { DEFAULT: 'var(--line)', strong: 'var(--line-strong)' },
        ink: {
          DEFAULT: 'var(--ink)', 2: 'var(--ink-2)', 3: 'var(--ink-3)', 4: 'var(--ink-4)',
        },
        purple: {
          50: 'var(--purple-50)', 100: 'var(--purple-100)', 200: '#C9A8F6', 300: '#A66FEF',
          400: '#8A3FEA', 500: 'var(--purple-500)', 700: 'var(--purple-700)', 800: '#410D8C',
          900: '#2E0962', DEFAULT: 'var(--purple-500)',
        },
        orange: {
          50: 'var(--orange-50)', 100: '#FFD9B3', 300: '#FFB870', 500: 'var(--orange-500)',
          700: 'var(--orange-700)', DEFAULT: 'var(--orange-500)',
        },
        green: { DEFAULT: 'var(--green)', 50: 'var(--green-50)' },
        amber: { DEFAULT: 'var(--amber)', 50: 'var(--amber-50)' },
        red: { DEFAULT: 'var(--red)', 50: 'var(--red-50)' },
        health: { on: '#16A34A', risk: '#F59E0B', off: '#DC2626' },
        // Azul e rosa eram hex literal dentro do Badge. Viram token porque, nas
        // palavras do documento, "a terceira tela que precisasse de azul
        // inventaria outro" — e dois azuis parecidos são piores que dois azuis
        // diferentes: ninguém sabe qual é o certo.
        blue: { DEFAULT: '#1D4ED8', 50: '#E6F0FE' },
        pink: { DEFAULT: '#C0005A', 50: '#FDE7F1' },
      },
      borderRadius: { sm: '7px', md: '10px', lg: '14px', xl: '18px' },
      boxShadow: {
        sm: '0 1px 2px rgba(20,18,30,.05), 0 1px 3px rgba(20,18,30,.04)',
        md: '0 2px 6px rgba(20,18,30,.06), 0 8px 24px rgba(20,18,30,.05)',
        pop: '0 12px 40px rgba(20,18,30,.16), 0 0 0 1px rgba(20,18,30,.05)',
      },
      fontFamily: { sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'] },
      // ┌───────────────────────────────────────────────────────────────────┐
      // │ A ESCALA NOMEADA do design system do Publi (seção 03).              │
      // │                                                                     │
      // │ O furo que ela fecha, e que o Pulse tinha igual: existia nome para   │
      // │ título e número grande, e NADA para os tamanhos onde a interface     │
      // │ inteira vive. Por isso cada tela escrevia `text-[13px]` à mão —      │
      // │ medido aqui antes da migração: 434 declarações arbitrárias em 46     │
      // │ arquivos.                                                           │
      // │                                                                     │
      // │ Os quatro do meio — corpo, meta, nota, micro — são ALIAS PURO, sem   │
      // │ altura de linha própria, exatamente como no documento. Trocar        │
      // │ `text-[13px]` por `text-corpo` não muda um pixel; muda quem decide   │
      // │ o tamanho.                                                          │
      // │                                                                     │
      // │ `kpi` valia 30px aqui e nunca foi usado: o KPI real era 22px escrito │
      // │ à mão, em seis telas. Passa a valer 22px, como no doc — token morto  │
      // │ vira token vivo sem mudar um pixel na tela.                          │
      // └───────────────────────────────────────────────────────────────────┘
      fontSize: {
        // Com peso e tracking próprios — são forma, não só tamanho.
        h1: ['22px', { lineHeight: '1.2', letterSpacing: '-0.025em', fontWeight: '700' }],
        title: ['17px', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '700' }],
        kpi: ['22px', { lineHeight: '1', letterSpacing: '-0.03em', fontWeight: '700' }],
        // Cabeçalho de tabela: sempre uppercase, e o tracking e o peso vêm juntos
        // porque sem eles o cabeçalho vira corpo pequeno.
        tabela: ['10.5px', { letterSpacing: '0.08em', fontWeight: '600' }],
        // Alias puro. Sem line-height, para não mudar entrelinha de nada.
        campo: ['16px', {}],
        secao: ['15px', {}],
        cartao: ['14px', {}],
        corpo: ['13px', {}],
        meta: ['12px', {}],
        nota: ['11px', {}],
        micro: ['10px', {}],
      },
      // Alturas de controle do doc (seção 04). Botão, input e select têm a MESMA
      // altura por degrau — é o que faz uma linha de formulário parecer uma linha.
      height: { control: '36px', 'control-sm': '32px', 'control-xs': '28px' },
      minHeight: { control: '36px', 'control-sm': '32px', 'control-xs': '28px' },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  // Import ESM em vez do require() do Publi: o lint deste repo proíbe require,
  // e o plugin é o mesmo.
  plugins: [animate],
}

export default alloyalPreset
