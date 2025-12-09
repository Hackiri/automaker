"use client";

import { useState, useEffect } from "react";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings, Key, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2, Zap, Sun, Moon, Palette } from "lucide-react";

export function SettingsView() {
  const { apiKeys, setApiKeys, setCurrentView, theme, setTheme } = useAppStore();
  const [anthropicKey, setAnthropicKey] = useState(apiKeys.anthropic);
  const [googleKey, setGoogleKey] = useState(apiKeys.google);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showGoogleKey, setShowGoogleKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testingGeminiConnection, setTestingGeminiConnection] = useState(false);
  const [geminiTestResult, setGeminiTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    setAnthropicKey(apiKeys.anthropic);
    setGoogleKey(apiKeys.google);
  }, [apiKeys]);

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);

    try {
      const response = await fetch("/api/claude/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ apiKey: anthropicKey }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setTestResult({ success: true, message: data.message || "Connection successful! Claude responded." });
      } else {
        setTestResult({ success: false, message: data.error || "Failed to connect to Claude API." });
      }
    } catch (error) {
      setTestResult({ success: false, message: "Network error. Please check your connection." });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleTestGeminiConnection = async () => {
    setTestingGeminiConnection(true);
    setGeminiTestResult(null);

    try {
      const response = await fetch("/api/gemini/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ apiKey: googleKey }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setGeminiTestResult({ success: true, message: data.message || "Connection successful! Gemini responded." });
      } else {
        setGeminiTestResult({ success: false, message: data.error || "Failed to connect to Gemini API." });
      }
    } catch (error) {
      setGeminiTestResult({ success: false, message: "Network error. Please check your connection." });
    } finally {
      setTestingGeminiConnection(false);
    }
  };

  const handleSave = () => {
    setApiKeys({
      anthropic: anthropicKey,
      google: googleKey,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden content-bg" data-testid="settings-view">
      {/* Header Section */}
      <div className="flex-shrink-0 border-b border-white/10 bg-zinc-950/50 backdrop-blur-md">
        <div className="px-8 py-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-purple-600 shadow-lg shadow-brand-500/20 flex items-center justify-center">
              <Settings className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Settings</h1>
              <p className="text-sm text-zinc-400">Configure your API keys and preferences</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* API Keys Section */}
          <div className="rounded-xl border border-white/10 bg-zinc-900/50 backdrop-blur-md overflow-hidden">
            <div className="p-6 border-b border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <Key className="w-5 h-5 text-brand-500" />
                <h2 className="text-lg font-semibold text-white">API Keys</h2>
              </div>
              <p className="text-sm text-zinc-400">
                Configure your AI provider API keys. Keys are stored locally in your browser.
              </p>
            </div>
            <div className="p-6 space-y-6">
              {/* Claude/Anthropic API Key */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Label htmlFor="anthropic-key" className="text-zinc-300">
                    Anthropic API Key (Claude)
                  </Label>
                  {apiKeys.anthropic && (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  )}
                </div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="anthropic-key"
                      type={showAnthropicKey ? "text" : "password"}
                      value={anthropicKey}
                      onChange={(e) => setAnthropicKey(e.target.value)}
                      placeholder="sk-ant-..."
                      className="pr-10 bg-zinc-950/50 border-white/10 text-white placeholder:text-zinc-500"
                      data-testid="anthropic-api-key-input"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3 text-zinc-400 hover:text-white hover:bg-transparent"
                      onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                      data-testid="toggle-anthropic-visibility"
                    >
                      {showAnthropicKey ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleTestConnection}
                    disabled={!anthropicKey || testingConnection}
                    className="bg-white/5 hover:bg-white/10 text-white border border-white/10"
                    data-testid="test-claude-connection"
                  >
                    {testingConnection ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4 mr-2" />
                        Test
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-zinc-500">
                  Used for Claude AI features. Get your key at{" "}
                  <a
                    href="https://console.anthropic.com/account/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-500 hover:text-brand-400 hover:underline"
                  >
                    console.anthropic.com
                  </a>
                  . Alternatively, the CLAUDE_CODE_OAUTH_TOKEN environment variable can be used.
                </p>
                {testResult && (
                  <div
                    className={`flex items-center gap-2 p-3 rounded-lg ${
                      testResult.success
                        ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                    }`}
                    data-testid="test-connection-result"
                  >
                    {testResult.success ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <AlertCircle className="w-4 h-4" />
                    )}
                    <span className="text-sm" data-testid="test-connection-message">{testResult.message}</span>
                  </div>
                )}
              </div>

              {/* Google API Key */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Label htmlFor="google-key" className="text-zinc-300">
                    Google API Key (Gemini)
                  </Label>
                  {apiKeys.google && (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  )}
                </div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="google-key"
                      type={showGoogleKey ? "text" : "password"}
                      value={googleKey}
                      onChange={(e) => setGoogleKey(e.target.value)}
                      placeholder="AIza..."
                      className="pr-10 bg-zinc-950/50 border-white/10 text-white placeholder:text-zinc-500"
                      data-testid="google-api-key-input"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3 text-zinc-400 hover:text-white hover:bg-transparent"
                      onClick={() => setShowGoogleKey(!showGoogleKey)}
                      data-testid="toggle-google-visibility"
                    >
                      {showGoogleKey ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleTestGeminiConnection}
                    disabled={!googleKey || testingGeminiConnection}
                    className="bg-white/5 hover:bg-white/10 text-white border border-white/10"
                    data-testid="test-gemini-connection"
                  >
                    {testingGeminiConnection ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4 mr-2" />
                        Test
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-zinc-500">
                  Used for Gemini AI features (including image/design prompts). Get your key at{" "}
                  <a
                    href="https://makersuite.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-500 hover:text-brand-400 hover:underline"
                  >
                    makersuite.google.com
                  </a>
                </p>
                {geminiTestResult && (
                  <div
                    className={`flex items-center gap-2 p-3 rounded-lg ${
                      geminiTestResult.success
                        ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                    }`}
                    data-testid="gemini-test-connection-result"
                  >
                    {geminiTestResult.success ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <AlertCircle className="w-4 h-4" />
                    )}
                    <span className="text-sm" data-testid="gemini-test-connection-message">{geminiTestResult.message}</span>
                  </div>
                )}
              </div>

              {/* Security Notice */}
              <div className="flex items-start gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-yellow-500">Security Notice</p>
                  <p className="text-yellow-500/80 text-xs mt-1">
                    API keys are stored in your browser's local storage. Never share your API keys
                    or commit them to version control.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Appearance Section */}
          <div className="rounded-xl border border-white/10 bg-zinc-900/50 backdrop-blur-md overflow-hidden">
            <div className="p-6 border-b border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <Palette className="w-5 h-5 text-brand-500" />
                <h2 className="text-lg font-semibold text-white">Appearance</h2>
              </div>
              <p className="text-sm text-zinc-400">
                Customize the look and feel of your application.
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-3">
                <Label className="text-zinc-300">Theme</Label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setTheme("dark")}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border transition-all ${
                      theme === "dark"
                        ? "bg-white/5 border-brand-500 text-white"
                        : "bg-zinc-950/50 border-white/10 text-zinc-400 hover:text-white hover:bg-white/5"
                    }`}
                    data-testid="dark-mode-button"
                  >
                    <Moon className="w-4 h-4" />
                    <span className="font-medium text-sm">Dark Mode</span>
                  </button>
                  <button
                    onClick={() => setTheme("light")}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border transition-all ${
                      theme === "light"
                        ? "bg-white/5 border-brand-500 text-white"
                        : "bg-zinc-950/50 border-white/10 text-zinc-400 hover:text-white hover:bg-white/5"
                    }`}
                    data-testid="light-mode-button"
                  >
                    <Sun className="w-4 h-4" />
                    <span className="font-medium text-sm">Light Mode</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex items-center gap-4">
            <Button
              onClick={handleSave}
              data-testid="save-settings"
              className="min-w-[120px] bg-gradient-to-r from-brand-500 to-purple-600 hover:from-brand-600 hover:to-purple-700 text-white border-0"
            >
              {saved ? (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Saved!
                </>
              ) : (
                "Save Settings"
              )}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setCurrentView("welcome")}
              className="bg-white/5 hover:bg-white/10 text-white border border-white/10"
              data-testid="back-to-home"
            >
              Back to Home
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
