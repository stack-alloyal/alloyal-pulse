/**
 * A lateral minimizada — o estado, e o script que o aplica antes da primeira pintura.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE ATRIBUTO NO <html> E NÃO ESTADO DO REACT.                          │
 * │                                                                            │
 * │ A largura da lateral empurra o conteúdo da página inteira. Se ela nascesse  │
 * │ com 252px no HTML e encolhesse para 64px depois de hidratar, quem escolheu  │
 * │ minimizada veria a tela inteira pular para a esquerda a cada navegação —    │
 * │ pior que o piscar de tema, porque move tudo e não só a cor.                 │
 * │                                                                            │
 * │ Então o mesmo desenho do tema (§02): um script inline no <head> lê a        │
 * │ escolha e marca `data-menu="min"` no <html> ANTES de qualquer pintura. O    │
 * │ CSS em `lateral.css` faz o resto, e o React nunca precisa saber em qual     │
 * │ estado está — o que também elimina qualquer divergência de hidratação: o    │
 * │ HTML do servidor e o do cliente são idênticos nos dois estados.             │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

export const CHAVE_LATERAL = 'pulse.menu.lateral'

/** Marcado no `<html>` quando a lateral está minimizada. Lido só pelo CSS. */
export const MARCA_MINIMIZADA = 'min'

export const SCRIPT_DA_LATERAL = `(function(){try{if(localStorage.getItem('${CHAVE_LATERAL}')==='${MARCA_MINIMIZADA}'){document.documentElement.setAttribute('data-menu','${MARCA_MINIMIZADA}')}}catch(e){}})()`
