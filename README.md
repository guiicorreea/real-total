# Real Total

Primeiro incremento de um aplicativo web responsivo para gestão financeira pessoal.

## O que está incluído

- Cadastro de múltiplas contas e produtos
- Instituições preparadas para Bradesco, PicPay e Nubank
- Importação manual de CSV, XLSX e PDF
- Importação manual de PDFs de boleto na tela de Boletos
- Leitura de PDFs protegidos com senha informada apenas durante o processamento
- Normalização de datas, valores, entradas, despesas e transferências
- Tela de revisão com categorias editáveis
- Detecção de duplicidades
- Dashboard inicial
- Orçamentos mensais por grupo e item
- Comparação entre previsto e realizado dos extratos
- Metas de divisão editáveis (ex.: essencial, variável e investimentos)
- Sincronização manual de anexos do Outlook/Hotmail via Microsoft Graph
- Boletos organizados por competência do vencimento
- Desdobramento de Pix ou gastos compostos entre categorias
- Múltiplos itens na mesma categoria com palavras-chave para separar o realizado
- Divisão de boleto entre você e sua parceira
- Receitas, renda extra e resultado do mês
- Persistência local no navegador para prototipagem

Os dados iniciais são fictícios. O protótipo funciona localmente no navegador; a integração com o Outlook usa OAuth somente leitura e ainda não possui backend seguro para produção.

## Executar

```bash
npm install
npm run dev
```

Para gerar a versão de produção:

```bash
npm run build
npm run preview
```

## Conectar Hotmail/Outlook

1. No [Microsoft Entra](https://entra.microsoft.com/), crie um registro de aplicativo do tipo **Aplicativo de página única (SPA)**.
2. Adicione `http://localhost:5173` como **URI de redirecionamento**.
3. Em permissões da API do Microsoft Graph, adicione as permissões delegadas `User.Read` e `Mail.Read`.
4. Copie `.env.example` para `.env` e preencha `VITE_AZURE_CLIENT_ID`.
5. Reinicie `npm run dev` e abra a tela **Boletos**.

A aplicação solicita apenas leitura de e-mail. Não solicita permissões para enviar, apagar ou pagar mensagens.

## Próximos passos

- Autenticação e banco de dados
- Processamento de PDF/OCR no servidor
- Metas financeiras
- Integração via Open Finance
- Regras avançadas para cartões, investimentos e transferências

## Reiniciar os dados locais

Na tela de **Configurações**, use:

- **Restaurar demonstração** para voltar aos dados fictícios.
- **Começar do zero** para apagar contas, transações e orçamentos e começar sem dados.

A opção também remove o armazenamento local antigo do protótipo anterior.
