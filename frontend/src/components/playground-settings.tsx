import { Code } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
} from "@/components/ui/field"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"

type SettingsProps = {
  open: boolean
  onOpenChange: (value: boolean) => void
  systemPrompt: string
  onSystemPromptChange: (value: string) => void
  temperature: number
  onTemperatureChange: (value: number) => void
  maxTokens: number
  onMaxTokensChange: (value: number) => void
  topP: number
  onTopPChange: (value: number) => void
  stream: boolean
  onStreamChange: (value: boolean) => void
  onExport: () => void
}

export function PlaygroundSettings(props: SettingsProps) {
  const mobile = useIsMobile()
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        className={
          mobile
            ? "flex h-[85dvh] max-h-[calc(100dvh-1rem)] flex-col gap-0 rounded-t-xl"
            : "flex w-full flex-col gap-0 sm:max-w-md"
        }
      >
        <SheetHeader className="border-b p-5 pr-12">
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            Configure your next request. Changes apply when you send a message.
          </SheetDescription>
        </SheetHeader>
        <Tabs defaultValue="instructions" className="min-h-0 flex-1 gap-5 pt-5">
          <TabsList className="mx-5" aria-label="Playground settings">
            <TabsTrigger value="instructions">Instructions</TabsTrigger>
            <TabsTrigger value="parameters">Parameters</TabsTrigger>
          </TabsList>
          <TabsContent
            value="instructions"
            className="min-h-0 overflow-y-auto px-5 pb-5"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="system-instructions">
                  System instructions
                </FieldLabel>
                <FieldDescription>
                  Set the model’s role, tone, or response format.
                </FieldDescription>
                <Textarea
                  id="system-instructions"
                  value={props.systemPrompt}
                  onChange={(event) =>
                    props.onSystemPromptChange(event.target.value)
                  }
                  className="min-h-48 resize-y"
                />
              </Field>
            </FieldGroup>
          </TabsContent>
          <TabsContent
            value="parameters"
            className="min-h-0 overflow-y-auto px-5 pb-5"
          >
            <FieldGroup>
              <Parameter
                label="Temperature"
                id="param-temp"
                value={props.temperature}
                display={props.temperature.toFixed(2)}
                min={0}
                max={2}
                step={0.05}
                onChange={props.onTemperatureChange}
                description="Lower values favor focused answers; higher values allow more variation."
              />
              <Parameter
                label="Maximum output tokens"
                id="param-max-tokens"
                value={props.maxTokens}
                display={props.maxTokens.toLocaleString()}
                min={256}
                max={8192}
                step={256}
                onChange={props.onMaxTokensChange}
                description="The maximum answer length requested from the model."
              />
              <Parameter
                label="Top-p"
                id="param-top-p"
                value={props.topP}
                display={props.topP.toFixed(2)}
                min={0}
                max={1}
                step={0.05}
                onChange={props.onTopPChange}
                description="Limit token sampling to the most likely portion of the distribution."
              />
              <Field orientation="horizontal">
                <Checkbox
                  id="param-stream"
                  checked={props.stream}
                  onCheckedChange={(value) =>
                    props.onStreamChange(value === true)
                  }
                />
                <div className="flex flex-col gap-1">
                  <FieldLabel htmlFor="param-stream">
                    Stream response
                  </FieldLabel>
                  <FieldDescription>
                    Show the answer as it arrives.
                  </FieldDescription>
                </div>
              </Field>
            </FieldGroup>
          </TabsContent>
        </Tabs>
        <div className="shrink-0 border-t p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <Button variant="outline" onClick={props.onExport}>
            <Code data-icon="inline-start" />
            Export draft code
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Parameter({
  label,
  id,
  value,
  display,
  min,
  max,
  step,
  onChange,
  description,
}: {
  label: string
  id: string
  value: number
  display: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  description: string
}) {
  return (
    <Field>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <output htmlFor={id} className="text-sm tabular-nums">
          {display}
        </output>
      </div>
      <Slider
        id={id}
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([value]) => onChange(value)}
      />
      <FieldDescription>{description}</FieldDescription>
    </Field>
  )
}
