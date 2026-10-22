import * as React from "react"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  ApiError,
  createProvider,
  deleteProvider,
  disableProvider,
  updateProvider,
  type Provider,
  type ProviderInput,
  type ProviderProtocol,
  type ProviderUpdate,
} from "@/lib/auth"
import { IconPlus, IconX } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Mirrors the backend alias validator: starts with a letter or digit and
// contains only letters, digits, ".", "_" or "-", with no "/" allowed.
const PROVIDER_ALIAS_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]*$"

type HeaderRow = {
  name: string
  value: string
}

type ProviderFormDrawerProps = {
  open: boolean
  provider: Provider | null
  onClose: () => void
  onSaved: (provider: Provider) => void
}

export function ProviderFormDrawer({
  open,
  provider,
  onClose,
  onSaved,
}: ProviderFormDrawerProps) {
  const isMobile = useIsMobile()
  const isEdit = provider !== null

  const [name, setName] = React.useState(() => provider?.name ?? "")
  const [alias, setAlias] = React.useState(() => provider?.aliases ?? "")
  const [baseUrl, setBaseUrl] = React.useState(() => provider?.base_url ?? "")
  const [protocol, setProtocol] = React.useState<ProviderProtocol>(
    () => provider?.protocol ?? "openai"
  )
  const [apiKeyValue, setApiKeyValue] = React.useState("")
  const [headerRows, setHeaderRows] = React.useState<HeaderRow[]>([])
  const [clearApiKey, setClearApiKey] = React.useState(false)
  const [clearHeader, setClearHeader] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  const aliasChanged =
    isEdit && alias.trim() !== "" && alias.trim() !== provider.aliases

  function addHeaderRow() {
    setHeaderRows((rows) => [...rows, { name: "", value: "" }])
  }

  function removeHeaderRow(index: number) {
    setHeaderRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index))
  }

  function setHeaderRow(index: number, patch: Partial<HeaderRow>) {
    setHeaderRows((rows) =>
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row
      )
    )
  }

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextName = name.trim()
    const nextAlias = alias.trim()
    const nextBaseUrl = baseUrl.trim()
    const nextApiKey = apiKeyValue.trim()
    const filledHeaders = headerRows
      .map((row) => ({ name: row.name.trim(), value: row.value.trim() }))
      .filter((row) => row.name !== "" || row.value !== "")

    if (!nextName) {
      setError("Enter a provider name.")
      return
    }
    if (!nextAlias) {
      setError("Enter an alias.")
      return
    }
    if (!nextBaseUrl) {
      setError("Enter a base URL.")
      return
    }
    if (!nextApiKey) {
      setError("Enter an API key.")
      return
    }
    if (filledHeaders.some((row) => row.name === "" || row.value === "")) {
      setError("Enter both a name and a value for each custom header.")
      return
    }
    const headerNames = filledHeaders.map((row) => row.name.toLowerCase())
    if (new Set(headerNames).size !== headerNames.length) {
      setError("Custom header names must be unique.")
      return
    }

    setPending(true)
    setError(null)

    try {
      if (isEdit && provider) {
        const changes: ProviderUpdate = {}
        if (nextName !== provider.name) changes.name = nextName
        if (nextAlias !== provider.aliases) changes.aliases = nextAlias
        if (nextBaseUrl !== provider.base_url) changes.base_url = nextBaseUrl
        if (protocol !== provider.protocol) changes.protocol = protocol
        if (clearApiKey) changes.api_key = ""
        else if (nextApiKey) changes.api_key = nextApiKey
        if (clearHeader) changes.custom_header = null
        else if (filledHeaders.length > 0) {
          changes.custom_header = Object.fromEntries(
            filledHeaders.map((row) => [row.name, row.value])
          )
        }

        if (Object.keys(changes).length === 0) {
          setError("No changes to save.")
          setPending(false)
          return
        }

        onSaved(await updateProvider(provider.id, changes))
        return
      }

      const input: ProviderInput = {
        name: nextName,
        aliases: nextAlias,
        base_url: nextBaseUrl,
        protocol,
        api_key: nextApiKey,
      }

      if (filledHeaders.length > 0) {
        input.custom_header = Object.fromEntries(
          filledHeaders.map((row) => [row.name, row.value])
        )
      }

      onSaved(await createProvider(input))
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : "Unable to save the provider."
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Drawer
      direction={isMobile ? "bottom" : "right"}
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DrawerContent>
        <DrawerHeader className="shrink-0 gap-1 border-b">
          <DrawerTitle>
            {isEdit ? "Edit provider" : "Create provider"}
          </DrawerTitle>
          <DrawerDescription>
            {isEdit
              ? "Update provider settings. Stored credentials are never returned."
              : "Register an upstream provider for the gateway."}
          </DrawerDescription>
        </DrawerHeader>
        <form
          id="provider-form"
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-2 text-sm"
          onSubmit={handleSubmit}
        >
          <div className="flex flex-col gap-3">
            <Label htmlFor="provider-name">Name</Label>
            <Input
              id="provider-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={255}
              required
              autoFocus={!isEdit}
            />
          </div>
          <div className="flex flex-col gap-3">
            <Label htmlFor="provider-alias">Alias</Label>
            <Input
              id="provider-alias"
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              pattern={PROVIDER_ALIAS_PATTERN}
              maxLength={64}
              required
            />
            <p className="text-xs text-muted-foreground">
              Starts with a letter or digit; may contain letters, digits,
              &quot;.&quot;, &quot;_&quot; or &quot;-&quot;. Used as the prefix
              for public model IDs.
            </p>
            {aliasChanged ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Changing the alias rewrites the public model ID of every synced
                model.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-3">
            <Label htmlFor="provider-protocol">Protocol</Label>
            <Select
              value={protocol}
              onValueChange={(value) => setProtocol(value as ProviderProtocol)}
            >
              <SelectTrigger id="provider-protocol" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-3">
            <Label htmlFor="provider-base-url">Base URL</Label>
            <Input
              id="provider-base-url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com"
              required
            />
          </div>
          <Separator />
          <div className="flex flex-col gap-3">
            <Label htmlFor="provider-api-key">
              {isEdit && provider.has_api_key ? "Replace API key" : "API key"}
            </Label>
            <Input
              id="provider-api-key"
              type="password"
              autoComplete="new-password"
              value={apiKeyValue}
              onChange={(event) => setApiKeyValue(event.target.value)}
              placeholder={
                isEdit && provider.has_api_key
                  ? "Leave blank to keep the stored key"
                  : undefined
              }
              required={!isEdit}
            />
            {isEdit && provider.has_api_key ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={clearApiKey}
                  onCheckedChange={(value) => setClearApiKey(value === true)}
                />
                Clear stored API key
              </label>
            ) : null}
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="provider-headers">Custom headers</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addHeaderRow}
              >
                <IconPlus />
                Add header
              </Button>
            </div>
            {headerRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Optional. Sent with every request to this provider
                {isEdit ? "; adding headers replaces any stored headers." : "."}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {headerRows.map((row, index) => (
                  <div
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2"
                    key={index}
                  >
                    <Input
                      aria-label={`Header ${index + 1} name`}
                      value={row.name}
                      onChange={(event) =>
                        setHeaderRow(index, { name: event.target.value })
                      }
                      placeholder="Name"
                    />
                    <Input
                      aria-label={`Header ${index + 1} value`}
                      value={row.value}
                      onChange={(event) =>
                        setHeaderRow(index, { value: event.target.value })
                      }
                      placeholder="Value"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground"
                      onClick={() => removeHeaderRow(index)}
                    >
                      <IconX />
                      <span className="sr-only">Remove header {index + 1}</span>
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {isEdit && provider.has_custom_header ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={clearHeader}
                  onCheckedChange={(value) => setClearHeader(value === true)}
                />
                Clear stored custom headers
              </label>
            ) : null}
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        <DrawerFooter
          className="shrink-0 border-t"
          style={{
            paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
          }}
        >
          <Button type="submit" form="provider-form" disabled={pending}>
            {pending
              ? isEdit
                ? "Saving…"
                : "Creating…"
              : isEdit
                ? "Save changes"
                : "Create provider"}
          </Button>
          <DrawerClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

type ProviderAction = "disable" | "delete"

type ProviderActionDrawerProps = {
  action: ProviderAction
  provider: Provider
  onClose: () => void
  onDone: () => void
}

export function ProviderActionDrawer({
  action,
  provider,
  onClose,
  onDone,
}: ProviderActionDrawerProps) {
  const isMobile = useIsMobile()
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  async function handleConfirm() {
    setPending(true)
    setError(null)

    try {
      if (action === "disable") {
        await disableProvider(provider.id)
      } else {
        await deleteProvider(provider.id)
      }
      onDone()
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : "Unable to complete the action."
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Drawer
      direction={isMobile ? "bottom" : "right"}
      open={true}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DrawerContent>
        <DrawerHeader className="gap-1">
          <DrawerTitle>
            {action === "disable"
              ? `Disable “${provider.name}”?`
              : `Delete “${provider.name}” permanently?`}
          </DrawerTitle>
          <DrawerDescription>
            {action === "disable"
              ? "The provider's models stop resolving for inference. Stored configuration is kept and the provider can be re-enabled."
              : "This removes the provider and all of its synced models. This cannot be undone."}
          </DrawerDescription>
        </DrawerHeader>
        {error ? (
          <p className="px-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DrawerFooter>
          <Button
            type="button"
            variant={action === "delete" ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending
              ? action === "disable"
                ? "Disabling…"
                : "Deleting…"
              : action === "disable"
                ? "Disable provider"
                : "Delete provider"}
          </Button>
          <DrawerClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
