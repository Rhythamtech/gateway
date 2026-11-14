import * as React from "react"
import { cn } from "cn"
import { CalendarIcon, Clock, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  formatTimestampInDeviceZone,
  getUserTimeZone,
} from "@/lib/datetime"

export interface DateTimePickerProps {
  id?: string
  value?: Date | null
  onChange?: (date: Date | null) => void
  disabled?: boolean
  minDate?: Date
  placeholder?: string
  className?: string
}

export function DateTimePicker({
  id,
  value,
  onChange,
  disabled = false,
  minDate,
  placeholder = "Pick expiration date & time",
  className,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false)

  const formattedValueTime = value
    ? `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`
    : ""
  const [userTime, setUserTime] = React.useState<string | null>(null)
  const timeString = userTime ?? (formattedValueTime || "23:59")

  const handleSelectDate = (selectedDate: Date | undefined) => {
    if (!selectedDate) {
      setUserTime(null)
      onChange?.(null)
      return
    }

    const [hours, minutes] = timeString.split(":").map(Number)
    const newDate = new Date(selectedDate)
    newDate.setHours(
      isNaN(hours) ? 23 : hours,
      isNaN(minutes) ? 59 : minutes,
      0,
      0
    )

    if (minDate && newDate.getTime() < minDate.getTime()) {
      const adjusted = new Date(minDate.getTime() + 60 * 60 * 1000)
      setUserTime(
        `${String(adjusted.getHours()).padStart(2, "0")}:${String(adjusted.getMinutes()).padStart(2, "0")}`
      )
      onChange?.(adjusted)
      return
    }

    onChange?.(newDate)
  }

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = e.target.value
    setUserTime(newTime)
    if (!newTime) return

    const [hours, minutes] = newTime.split(":").map(Number)
    if (isNaN(hours) || isNaN(minutes)) return

    const baseDate = value ? new Date(value) : (minDate ? new Date(minDate) : new Date())
    baseDate.setHours(hours, minutes, 0, 0)
    onChange?.(baseDate)
  }

  const isDateDisabled = (date: Date) => {
    if (!minDate) return false
    const startOfMinDay = new Date(minDate)
    startOfMinDay.setHours(0, 0, 0, 0)
    return date < startOfMinDay
  }

  const handlePreset = (days: number) => {
    const start = minDate ? new Date(minDate) : new Date()
    const target = new Date(start.getTime() + days * 24 * 60 * 60 * 1000)
    setUserTime(null)
    onChange?.(target)
  }

  const handleClear = () => {
    setUserTime(null)
    onChange?.(null)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-between text-left font-normal h-9",
            !value && "text-muted-foreground",
            className
          )}
        >
          <div className="flex items-center gap-2 truncate">
            <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {value ? formatTimestampInDeviceZone(value) : placeholder}
            </span>
          </div>
          {value && !disabled && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear date"
              className="ml-2 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                handleClear()
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation()
                  handleClear()
                }
              }}
            >
              <X className="size-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col">
          {/* Quick preset chips */}
          <div className="flex flex-wrap items-center gap-1.5 border-b p-2">
            <span className="text-[11px] font-medium text-muted-foreground px-1">
              Presets:
            </span>
            {[
              { label: "1 day", days: 1 },
              { label: "3 days", days: 3 },
              { label: "7 days", days: 7 },
              { label: "30 days", days: 30 },
            ].map(({ label, days }) => (
              <Button
                key={label}
                type="button"
                variant="outline"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => handlePreset(days)}
              >
                {label}
              </Button>
            ))}
          </div>

          {/* Calendar Picker */}
          <Calendar
            mode="single"
            selected={value ?? undefined}
            onSelect={handleSelectDate}
            disabled={isDateDisabled}
            autoFocus
          />

          {/* Time Picker Controls */}
          <div className="border-t p-3 flex items-center justify-between gap-3 bg-muted/20">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Clock className="size-3.5" />
              <span>Time ({getUserTimeZone()})</span>
            </div>
            <Input
              type="time"
              value={timeString}
              onChange={handleTimeChange}
              className="h-8 w-28 text-xs font-mono"
            />
          </div>

          {/* Action Footer */}
          <div className="border-t p-2 flex items-center justify-between gap-2 bg-muted/10">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleClear}
            >
              Clear
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setOpen(false)}
            >
              Done
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
