# Plano de simplificação — Real Total

## 1. Situação atual

O app está em um único arquivo `src/App.jsx` (~3.600 linhas) com 9 entradas no menu:

1. Visão geral (dashboard)
2. Transações
3. Importar extrato
4. Boletos
5. Contas
6. Orçamentos
7. Insights
8. Simular
9. Metas (em breve)
+ Configurações

Funcionalidades ricas: contas/saldos, boletos + Outlook, duplicidades, desdobramento (split),
palavras-chave, conciliação, insights, simulador, metas (placeholder).

## 2. Objetivo da simplificação

Manter as 4 coisas que o usuário pediu como núcleo, **sem remover nenhuma feature existente**,
apenas reorganizando a experiência para ficar mais simples e direta:

- **Orçamento (previsto)** — itens planejados por mês
- **Realizado** — lançamentos vindos do extrato do banco OU digitados manualmente
- **Simulador** — cenários a partir do orçamento
- **Receita** — vinda do extrato OU informada manualmente

Princípio: *"menos telas, mais ações diretas; o orçamento e o realizado ficam lado a lado"*.

## 3. Nova arquitetura de informação (menu)

De 9 itens para **5 itens**:

| Novo menu | Origem | Conteúdo |
|-----------|--------|----------|
| **Início** | Visão geral | Resumo do mês: receita, realizado vs. previsto, saldo, alertas de vencimento, atalhos rápidos |
| **Orçamento** | Orçamentos + Insights | Previsto (itens) + realizado (por categoria) + previsto vs. realizado + grupos + receita. Insights vira aba/seção dentro do Orçamento |
| **Lançamentos** | Transações + Importar extrato | Lista de lançamentos + botão "Importar extrato" + "Novo lançamento manual" + filtros |
| **Simular** | Simular | Mantido (cenários) |
| **Configurações** | Contas + Boletos + Settings | Contas, boletos/Outlook, perfil, dados (demo/limpar), alertas |

**Metas** (placeholder "em breve") é removida do menu (já não existe de fato).

## 4. Mudanças de fluxo (o que fica mais simples)

1. **Um único lugar para "realizado"**: a tela Lançamentos concentra importação de extrato e lançamento manual. Hoje são 2 telas separadas (Transações + Importar extrato).
2. **Orçamento e realizado na mesma tela**: o Orçamento passa a mostrar, ao lado de cada item, o quanto já foi realizado, sem precisar ir em Insights.
3. **Receita no mesmo lugar do orçamento**: receita do mês (manual ou vinda do extrato) fica no topo da tela Orçamento, não escondida.
4. **Contas e boletos viram "configuração"**: não aparecem no menu principal; acessíveis em Configurações (e via atalhos do Início).
5. **Menos modais encadeados**: importação de extrato vira fluxo de 2 passos (enviar arquivo → revisar → confirmar) dentro da própria tela Lançamentos, sem trocar de rota.
6. **Dashboard mais leve**: Início mostra apenas o essencial (receita, despesa, saldo, top categorias, próximos vencimentos) e 3 atalhos.

## 5. O que NÃO muda (mantido intacto)

- Parser de extratos (CSV/XLSX/PDF) e OCR
- Sincronização Outlook/Hotmail
- Conciliação de boletos com transações
- Desdobramento (split) e palavras-chave
- Detecção de duplicidades
- Persistência local + nuvem (Supabase)
- Simulador (cenários salvos)
- Todos os handlers de estado em `AppRoot`

## 6. Fases de implementação

### Fase 1 — Navegação e roteamento (baixo risco)
- Reescrever `navItems` e `viewTitles` para os 5 itens.
- Mapear views antigas para novas: `transactions`+`import` → `lancamentos`; `budgets`+`insights` → `orcamento`; `accounts`+`bills`+`settings` → `configuracoes`.
- Manter estado interno e handlers; apenas mudar qual componente renderiza em cada view.
- Adicionar redirects para compatibilidade (ex.: `navigate('transactions')` → `lancamentos`).

### Fase 2 — Tela Lançamentos unificada (médio risco)
- Criar `LancamentosPage` que combina `TransactionsPage` + `ImportPage` em abas/seções.
- Botões: "Importar extrato" (abre área de importação inline) e "Novo lançamento".
- Reusar handlers existentes (`handleParse`, `handleConfirmImport`, `handleSaveTransaction`, etc.).

### Fase 3 — Tela Orçamento unificada (médio risco)
- Criar `OrcamentoPage` que combina `BudgetsPage` + `InsightsPage`.
- Aba "Previsto" (itens de orçamento) e aba "Realizado vs. previsto" (insights).
- Receita do mês no topo, editável, com opção de puxar do extrato (já existe via transações de income).

### Fase 4 — Configurações (baixo risco)
- Criar `ConfiguracoesPage` com seções: Contas, Boletos/Outlook, Perfil/Alertas, Dados.
- Reusar `AccountsPage`, `BillsPage`, `SettingsPage` como seções internas.

### Fase 5 — Início (dashboard) simplificado (baixo risco)
- Simplificar `DashboardPage`: remover cards secundários, manter receita/despesa/saldo/top categorias/alertas e 3 atalhos.
- Atalhos: "Importar extrato", "Novo lançamento", "Simular".

### Fase 6 — Limpeza e testes
- Remover código morto (views antigas não usadas), verificar build.
- Rodar `npm run build`.
- Testar fluxos principais manualmente.

## 7. Riscos e mitigações

- **Arquivo único gigante**: risco de regressão. Mitigação: mudanças incrementais por fase, build a cada fase, commits separados.
- **Estado compartilhado**: handlers dependem de views; manter handlers intocados, só mudar renderização.
- **Estilos**: CSS pode ter seletores por view; verificar `styles.css` para classes específicas.
- **Persistência**: não tocar em `storage.js` / `supabase.js`.

## 8. O que preciso de você (decisões)

1. Aprova a nova IA de 5 itens (Início, Orçamento, Lançamentos, Simular, Configurações)?
2. Insights deve virar aba dentro de Orçamento, ou pode ser removido do menu principal (acessível por link)?
3. Contas e Boletos em Configurações (sub-páginas) ou manter como itens do menu principal também?
4. Quer que eu comece pela Fase 1 (navegação) agora, ou ajusta algo antes?

## 9. Próximo passo (se aprovado)

Criar branch `simplify-ui`, implementar Fase 1, build, mostrar resultado, iterar.