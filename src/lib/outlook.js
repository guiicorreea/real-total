import { PublicClientApplication } from '@azure/msal-browser'
import { parseBillPdf } from './parser.js'

const clientId = import.meta.env.VITE_AZURE_CLIENT_ID
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID || 'consumers'
const redirectUri = import.meta.env.VITE_AZURE_REDIRECT_URI || window.location.origin
const graphScopes = ['User.Read', 'Mail.Read']
const graphRoot = 'https://graph.microsoft.com/v1.0'

let msalInstance
let redirectHandled = false

export function isOutlookConfigured() {
  return Boolean(clientId)
}

async function getMsal() {
  if (!isOutlookConfigured()) {
    throw new Error('Configure VITE_AZURE_CLIENT_ID no arquivo .env antes de conectar o Outlook.')
  }
  if (!msalInstance) {
    msalInstance = new PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri,
      },
      cache: {
        cacheLocation: 'sessionStorage',
        storeAuthStateInCookie: false,
      },
    })
    await msalInstance.initialize()
  }
  const hasRedirectParams = new URLSearchParams(window.location.search).has('code') || new URLSearchParams(window.location.search).has('error')
  if (!redirectHandled || hasRedirectParams) {
    redirectHandled = true
    const redirectResult = await msalInstance.handleRedirectPromise()
    if (redirectResult?.account) msalInstance.setActiveAccount(redirectResult.account)
    if (hasRedirectParams) window.history.replaceState({}, document.title, window.location.pathname)
  }
  return msalInstance
}

function activeAccount(msal) {
  return msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null
}

export async function connectOutlook() {
  const msal = await getMsal()
  await msal.loginRedirect({ scopes: graphScopes, prompt: 'select_account' })
  return null
}

export async function initializeOutlook() {
  if (!isOutlookConfigured()) return null
  const msal = await getMsal()
  return activeAccount(msal)
}

export async function disconnectOutlook() {
  const msal = await getMsal()
  const account = activeAccount(msal)
  if (!account) return
  await msal.logoutPopup({ account, postLogoutRedirectUri: window.location.origin })
}

async function getGraphToken() {
  const msal = await getMsal()
  const account = activeAccount(msal)
  if (!account) throw new Error('Conecte sua conta Outlook primeiro.')
  const result = await msal.acquireTokenSilent({ scopes: graphScopes, account })
  return { token: result.accessToken, account }
}

async function graphFetch(path, token) {
  const response = await fetch(`${graphRoot}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Microsoft Graph respondeu ${response.status}. ${detail.slice(0, 180)}`)
  }
  return response
}

function senderName(message) {
  return message.from?.emailAddress?.name || message.from?.emailAddress?.address || 'Remetente desconhecido'
}

export async function listRecentOutlookMessages({ days = 90 } = {}) {
  const { token } = await getGraphToken()
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const filter = `receivedDateTime ge ${since} and hasAttachments eq true`
  const query = `?$top=50&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,hasAttachments&$filter=${encodeURIComponent(filter)}`
  const response = await graphFetch(`/me/messages${query}`, token)
  const payload = await response.json()
  return (payload.value ?? []).map((message) => ({
    id: message.id,
    subject: message.subject || 'Sem assunto',
    sender: senderName(message),
    receivedAt: message.receivedDateTime,
    hasAttachments: Boolean(message.hasAttachments),
  }))
}

export async function downloadPdfAttachment({ messageId, attachmentId, name, contentType }) {
  const { token } = await getGraphToken()
  const response = await graphFetch(`/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`, token)
  const buffer = await response.arrayBuffer()
  return new File([buffer], name || 'boleto.pdf', { type: contentType || 'application/pdf' })
}

export async function syncOutlookBills({ days = 90, onProgress } = {}) {
  const { token, account } = await getGraphToken()
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const filter = `receivedDateTime ge ${since} and hasAttachments eq true`
  const query = `?$top=50&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,hasAttachments&$filter=${encodeURIComponent(filter)}`
  const messagesResponse = await graphFetch(`/me/messages${query}`, token)
  const messagePayload = await messagesResponse.json()
  const messages = messagePayload.value ?? []
  const candidates = []

  for (const message of messages) {
    const attachmentsResponse = await graphFetch(`/me/messages/${encodeURIComponent(message.id)}/attachments?$select=id,name,contentType,size,isInline`, token)
    const attachmentPayload = await attachmentsResponse.json()
    const pdfAttachments = (attachmentPayload.value ?? []).filter((attachment) => !attachment.isInline && (attachment.contentType === 'application/pdf' || String(attachment.name || '').toLowerCase().endsWith('.pdf')))

    for (const attachment of pdfAttachments) {
      onProgress?.({ stage: 'downloading', subject: message.subject })
      const file = await downloadPdfAttachment({ messageId: message.id, attachmentId: attachment.id, name: attachment.name, contentType: attachment.contentType })
      const parsed = await parseBillPdf(file, '', message.subject)
      candidates.push({
        id: `outlook-${message.id}-${attachment.id}`,
        messageId: message.id,
        attachmentId: attachment.id,
        attachmentName: attachment.name,
        subject: message.subject || 'Boleto',
        sender: senderName(message),
        receivedAt: message.receivedDateTime,
        accountName: account?.name ?? '',
        source: 'outlook',
        file,
        ...parsed,
      })
      onProgress?.({ stage: 'processed', subject: message.subject })
    }
  }

  return { account, messages, candidates }
}

export { graphScopes }
