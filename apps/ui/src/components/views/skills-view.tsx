import { useState, useCallback, useMemo, useEffect } from 'react';
import { createLogger } from '@automaker/utils/logger';
import { useAppStore, type ProjectAnalysis, type FileTreeNode } from '@/store/app-store';
import { getElectronAPI } from '@/lib/electron';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Wand2,
  Download,
  Eye,
  Pencil,
  ChevronRight,
  ChevronDown,
  Server,
  Database,
  Cloud,
  GitBranch,
  Code,
  Settings,
  RefreshCw,
  FileText,
  Check,
  X,
  Copy,
  FolderOpen,
  Search,
  ToggleLeft,
  ToggleRight,
  Filter,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const logger = createLogger('SkillsView');

// Skill category types that can be auto-generated from project analysis
type SkillCategory = 'service' | 'database' | 'api' | 'cicd' | 'config' | 'custom';

// Skill representation for the UI
interface GeneratedSkill {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  enabled: boolean;
  content: string; // The markdown body content
  detectedFrom: string; // What triggered detection (e.g., "package.json", "docker-compose.yml")
  metadata: {
    version?: string;
    dependencies?: string[];
    allowedTools?: string[];
  };
}

// Get icon for skill category
function getCategoryIcon(category: SkillCategory) {
  switch (category) {
    case 'service':
      return Server;
    case 'database':
      return Database;
    case 'api':
      return Cloud;
    case 'cicd':
      return GitBranch;
    case 'config':
      return Settings;
    case 'custom':
    default:
      return Code;
  }
}

// Get category label
function getCategoryLabel(category: SkillCategory): string {
  switch (category) {
    case 'service':
      return 'Services';
    case 'database':
      return 'Databases';
    case 'api':
      return 'APIs';
    case 'cicd':
      return 'CI/CD';
    case 'config':
      return 'Configuration';
    case 'custom':
    default:
      return 'Custom';
  }
}

// Generate SKILL.md content from a skill
function generateSkillMarkdown(skill: GeneratedSkill): string {
  const frontmatter = [
    '---',
    `name: ${skill.name.toLowerCase().replace(/\s+/g, '-')}`,
    `description: ${skill.description}`,
  ];

  if (skill.metadata.version) {
    frontmatter.push(`version: "${skill.metadata.version}"`);
  }

  if (skill.metadata.dependencies && skill.metadata.dependencies.length > 0) {
    frontmatter.push('dependencies:');
    skill.metadata.dependencies.forEach((dep) => {
      frontmatter.push(`  - ${dep}`);
    });
  }

  if (skill.metadata.allowedTools && skill.metadata.allowedTools.length > 0) {
    frontmatter.push('allowed-tools:');
    skill.metadata.allowedTools.forEach((tool) => {
      frontmatter.push(`  - ${tool}`);
    });
  }

  frontmatter.push('---');
  frontmatter.push('');

  return frontmatter.join('\n') + skill.content;
}

// Generate unique ID
function generateId(): string {
  return `skill-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function SkillsView() {
  const { currentProject, projectAnalysis, isAnalyzing, setIsAnalyzing, setProjectAnalysis } =
    useAppStore();

  const [skills, setSkills] = useState<GeneratedSkill[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<GeneratedSkill | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isPreviewDialogOpen, setIsPreviewDialogOpen] = useState(false);
  const [editedSkill, setEditedSkill] = useState<GeneratedSkill | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<SkillCategory>>(
    new Set(['service', 'database', 'api', 'cicd', 'config'])
  );
  const [isExporting, setIsExporting] = useState(false);
  const [exportedSkills, setExportedSkills] = useState<Set<string>>(new Set());
  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<SkillCategory | 'all'>('all');

  // Filter skills based on search query and category filter
  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      // Apply category filter
      if (categoryFilter !== 'all' && skill.category !== categoryFilter) {
        return false;
      }
      // Apply search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return (
          skill.name.toLowerCase().includes(query) ||
          skill.description.toLowerCase().includes(query) ||
          skill.detectedFrom.toLowerCase().includes(query) ||
          skill.metadata.dependencies?.some((dep) => dep.toLowerCase().includes(query))
        );
      }
      return true;
    });
  }, [skills, searchQuery, categoryFilter]);

  // Group filtered skills by category
  const skillsByCategory = useMemo(() => {
    const grouped = new Map<SkillCategory, GeneratedSkill[]>();
    filteredSkills.forEach((skill) => {
      const existing = grouped.get(skill.category) || [];
      existing.push(skill);
      grouped.set(skill.category, existing);
    });
    return grouped;
  }, [filteredSkills]);

  // Categories that have skills (from all skills, for filter dropdown)
  const allCategories = useMemo(() => {
    const categories = new Set<SkillCategory>();
    skills.forEach((skill) => categories.add(skill.category));
    return Array.from(categories);
  }, [skills]);

  // Categories that have filtered skills (for display)
  const activeCategories = useMemo(() => {
    return Array.from(skillsByCategory.keys());
  }, [skillsByCategory]);

  // Toggle category expansion
  const toggleCategory = (category: SkillCategory) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Toggle skill enabled state
  const toggleSkillEnabled = (skillId: string) => {
    setSkills((prev) => prev.map((s) => (s.id === skillId ? { ...s, enabled: !s.enabled } : s)));
  };

  // Bulk enable all visible skills
  const enableAllVisible = useCallback(() => {
    const visibleIds = new Set(filteredSkills.map((s) => s.id));
    setSkills((prev) => prev.map((s) => (visibleIds.has(s.id) ? { ...s, enabled: true } : s)));
    toast.success('Skills enabled', {
      description: `Enabled ${filteredSkills.length} skill${filteredSkills.length !== 1 ? 's' : ''}`,
    });
  }, [filteredSkills]);

  // Bulk disable all visible skills
  const disableAllVisible = useCallback(() => {
    const visibleIds = new Set(filteredSkills.map((s) => s.id));
    setSkills((prev) => prev.map((s) => (visibleIds.has(s.id) ? { ...s, enabled: false } : s)));
    toast.success('Skills disabled', {
      description: `Disabled ${filteredSkills.length} skill${filteredSkills.length !== 1 ? 's' : ''}`,
    });
  }, [filteredSkills]);

  // Scan directory for files
  const scanDirectory = useCallback(
    async (path: string, depth: number = 0): Promise<FileTreeNode[]> => {
      if (depth > 5) return [];

      const api = getElectronAPI();
      try {
        const result = await api.readdir(path);
        if (!result.success || !result.entries) return [];

        const ignorePatterns = [
          'node_modules',
          '.git',
          '.next',
          'dist',
          'build',
          '.DS_Store',
          'coverage',
          '__pycache__',
          '.venv',
          'venv',
        ];

        const nodes: FileTreeNode[] = [];
        const entries = result.entries.filter(
          (e) => !ignorePatterns.includes(e.name) && !e.name.startsWith('.')
        );

        for (const entry of entries) {
          const fullPath = `${path}/${entry.name}`;
          const extension = entry.isFile ? entry.name.split('.').pop() || '' : undefined;

          const node: FileTreeNode = {
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory,
            extension,
          };

          if (entry.isDirectory && depth < 3) {
            node.children = await scanDirectory(fullPath, depth + 1);
          }

          nodes.push(node);
        }

        return nodes;
      } catch (error) {
        logger.error('Failed to scan directory:', path, error);
        return [];
      }
    },
    []
  );

  // Read file content
  const readFileContent = useCallback(async (filePath: string): Promise<string | null> => {
    try {
      const api = getElectronAPI();
      const result = await api.readFile(filePath);
      if (result.success && result.content) {
        return result.content;
      }
    } catch (error) {
      logger.error('Failed to read file:', filePath, error);
    }
    return null;
  }, []);

  // Generate skills from project analysis
  const generateSkillsFromAnalysis = useCallback(async () => {
    if (!currentProject) return;

    setIsGenerating(true);
    const generatedSkills: GeneratedSkill[] = [];

    try {
      const api = getElectronAPI();

      // Read package.json for dependencies
      const packageJsonPath = `${currentProject.path}/package.json`;
      const packageJsonContent = await readFileContent(packageJsonPath);
      let packageJson: Record<string, unknown> | null = null;

      if (packageJsonContent) {
        try {
          packageJson = JSON.parse(packageJsonContent);
        } catch {
          // Ignore parse errors
        }
      }

      // Detect services from package.json dependencies
      if (packageJson) {
        const deps = {
          ...((packageJson.dependencies as Record<string, string>) || {}),
          ...((packageJson.devDependencies as Record<string, string>) || {}),
        };

        // Express/Fastify/Hono API server
        if (deps.express || deps.fastify || deps.hono) {
          const framework = deps.express ? 'Express' : deps.fastify ? 'Fastify' : 'Hono';
          generatedSkills.push({
            id: generateId(),
            name: `${framework} API Server`,
            description: `Handle ${framework} API development, routing, middleware configuration, and request handling.`,
            category: 'api',
            enabled: true,
            detectedFrom: 'package.json',
            content: `# ${framework} API Server Skill

## Overview
This skill provides guidance for working with the ${framework} API server in this project.

## Key Patterns
- Route handlers are typically located in \`src/routes/\` or \`routes/\`
- Middleware configuration in \`src/middleware/\` or root level
- Error handling follows ${framework} conventions

## Common Tasks
- Adding new API endpoints
- Implementing middleware
- Request/response handling
- Error management

## Best Practices
- Use async/await for asynchronous operations
- Implement proper error handling middleware
- Validate request inputs
- Use appropriate HTTP status codes
`,
            metadata: {
              version: '1.0.0',
              dependencies: [framework.toLowerCase()],
              allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Grep'],
            },
          });
        }

        // React/Next.js frontend
        if (deps.react || deps.next) {
          const framework = deps.next ? 'Next.js' : 'React';
          generatedSkills.push({
            id: generateId(),
            name: `${framework} Frontend`,
            description: `Develop ${framework} components, pages, hooks, and state management.`,
            category: 'service',
            enabled: true,
            detectedFrom: 'package.json',
            content: `# ${framework} Frontend Skill

## Overview
This skill provides guidance for ${framework} frontend development.

## Project Structure
${deps.next ? '- Pages in `pages/` or `app/` directory\n- API routes in `pages/api/` or `app/api/`' : '- Components in `src/components/`\n- Pages/views in `src/pages/` or `src/views/`'}
- Shared hooks in \`src/hooks/\`
- Utility functions in \`src/lib/\` or \`src/utils/\`

## Key Patterns
- Component-based architecture
- ${deps.next ? 'Server and Client Components' : 'Functional components with hooks'}
- State management with ${deps.zustand ? 'Zustand' : deps.redux ? 'Redux' : deps['@tanstack/react-query'] ? 'React Query' : 'React hooks'}

## Best Practices
- Keep components small and focused
- Use TypeScript for type safety
- Implement proper loading and error states
- Follow accessibility guidelines
`,
            metadata: {
              version: '1.0.0',
              dependencies: [framework.toLowerCase().replace('.', '')],
              allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep'],
            },
          });
        }

        // Database skills
        if (deps.prisma || deps['@prisma/client']) {
          generatedSkills.push({
            id: generateId(),
            name: 'Prisma ORM',
            description: 'Manage database schemas, migrations, and queries using Prisma ORM.',
            category: 'database',
            enabled: true,
            detectedFrom: 'package.json',
            content: `# Prisma ORM Skill

## Overview
This project uses Prisma as the database ORM.

## Key Files
- Schema definition: \`prisma/schema.prisma\`
- Migrations: \`prisma/migrations/\`
- Seed data: \`prisma/seed.ts\` (if exists)

## Common Commands
\`\`\`bash
# Generate Prisma client
npx prisma generate

# Create migration
npx prisma migrate dev --name <migration-name>

# Apply migrations
npx prisma migrate deploy

# Open Prisma Studio
npx prisma studio
\`\`\`

## Best Practices
- Always run \`prisma generate\` after schema changes
- Use meaningful migration names
- Review generated SQL before applying
- Use transactions for related operations
`,
            metadata: {
              version: '1.0.0',
              dependencies: ['prisma', '@prisma/client'],
              allowedTools: ['Read', 'Edit', 'Write', 'Bash'],
            },
          });
        }

        // TypeScript configuration
        if (deps.typescript) {
          generatedSkills.push({
            id: generateId(),
            name: 'TypeScript Configuration',
            description:
              'Configure TypeScript compiler options, type definitions, and strict mode settings.',
            category: 'config',
            enabled: true,
            detectedFrom: 'package.json',
            content: `# TypeScript Configuration Skill

## Overview
This project uses TypeScript for type safety.

## Key Files
- \`tsconfig.json\` - Main TypeScript configuration
- \`tsconfig.*.json\` - Extended configs for specific targets

## Type Definitions
- Custom types in \`src/types/\` or \`types/\`
- Module declarations in \`src/types/*.d.ts\`

## Best Practices
- Use strict mode for maximum type safety
- Define interfaces for all API responses
- Use generics for reusable components
- Avoid \`any\` - use \`unknown\` when type is uncertain
`,
            metadata: {
              version: '1.0.0',
              dependencies: ['typescript'],
              allowedTools: ['Read', 'Edit', 'Write'],
            },
          });
        }

        // Testing frameworks
        if (deps.jest || deps.vitest || deps['@playwright/test'] || deps.playwright) {
          const testFramework =
            deps.playwright || deps['@playwright/test']
              ? 'Playwright'
              : deps.vitest
                ? 'Vitest'
                : 'Jest';
          generatedSkills.push({
            id: generateId(),
            name: `${testFramework} Testing`,
            description: `Write and run ${testFramework} tests, configure test environments, and debug test failures.`,
            category: 'cicd',
            enabled: true,
            detectedFrom: 'package.json',
            content: `# ${testFramework} Testing Skill

## Overview
This project uses ${testFramework} for testing.

## Test Location
${
  testFramework === 'Playwright'
    ? '- E2E tests in `tests/` or `e2e/`\n- Test configuration in `playwright.config.ts`'
    : '- Unit tests alongside source files (`*.test.ts`, `*.spec.ts`)\n- Test configuration in `jest.config.js` or `vitest.config.ts`'
}

## Running Tests
\`\`\`bash
${
  testFramework === 'Playwright'
    ? '# Run all tests\nnpm run test\n\n# Run with UI mode\nnpm run test:headed\n\n# Run specific test file\nnpx playwright test tests/specific.test.ts'
    : '# Run all tests\nnpm run test\n\n# Run in watch mode\nnpm run test:watch\n\n# Run specific test file\nnpm run test -- path/to/test.ts'
}
\`\`\`

## Best Practices
- Write descriptive test names
- Use arrange-act-assert pattern
- Mock external dependencies
- Aim for high coverage of critical paths
`,
            metadata: {
              version: '1.0.0',
              dependencies: [testFramework.toLowerCase()],
              allowedTools: ['Read', 'Edit', 'Write', 'Bash'],
            },
          });
        }

        // Docker
        const dockerfilePath = `${currentProject.path}/Dockerfile`;
        const dockerComposeExists = await api.exists(`${currentProject.path}/docker-compose.yml`);
        const dockerfileExists = await api.exists(dockerfilePath);

        if (dockerfileExists || dockerComposeExists) {
          generatedSkills.push({
            id: generateId(),
            name: 'Docker Configuration',
            description:
              'Manage Docker containers, images, and compose configurations for development and deployment.',
            category: 'cicd',
            enabled: true,
            detectedFrom: dockerfileExists ? 'Dockerfile' : 'docker-compose.yml',
            content: `# Docker Configuration Skill

## Overview
This project uses Docker for containerization.

## Key Files
${dockerfileExists ? '- `Dockerfile` - Main container definition' : ''}
${dockerComposeExists ? '- `docker-compose.yml` - Multi-container orchestration' : ''}

## Common Commands
\`\`\`bash
# Build image
docker build -t myapp .

# Run container
docker run -p 3000:3000 myapp

${dockerComposeExists ? '# Start all services\ndocker-compose up -d\n\n# View logs\ndocker-compose logs -f\n\n# Stop services\ndocker-compose down' : ''}
\`\`\`

## Best Practices
- Use multi-stage builds for smaller images
- Don't run as root in containers
- Use .dockerignore to exclude unnecessary files
- Pin base image versions
`,
            metadata: {
              version: '1.0.0',
              dependencies: ['docker'],
              allowedTools: ['Read', 'Edit', 'Write', 'Bash'],
            },
          });
        }

        // GitHub Actions
        const githubActionsPath = `${currentProject.path}/.github/workflows`;
        const githubActionsExists = await api.exists(githubActionsPath);

        if (githubActionsExists) {
          generatedSkills.push({
            id: generateId(),
            name: 'GitHub Actions CI/CD',
            description:
              'Configure GitHub Actions workflows for continuous integration and deployment.',
            category: 'cicd',
            enabled: true,
            detectedFrom: '.github/workflows/',
            content: `# GitHub Actions CI/CD Skill

## Overview
This project uses GitHub Actions for CI/CD.

## Workflow Location
- Workflows in \`.github/workflows/\`
- Each \`.yml\` file defines a workflow

## Workflow Structure
\`\`\`yaml
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test
\`\`\`

## Best Practices
- Use matrix builds for multiple versions
- Cache dependencies for faster builds
- Use secrets for sensitive data
- Run tests on pull requests
`,
            metadata: {
              version: '1.0.0',
              dependencies: [],
              allowedTools: ['Read', 'Edit', 'Write'],
            },
          });
        }

        // Tailwind CSS
        if (deps.tailwindcss) {
          generatedSkills.push({
            id: generateId(),
            name: 'Tailwind CSS',
            description:
              'Style components using Tailwind CSS utility classes and custom configurations.',
            category: 'config',
            enabled: true,
            detectedFrom: 'package.json',
            content: `# Tailwind CSS Skill

## Overview
This project uses Tailwind CSS for styling.

## Configuration
- \`tailwind.config.js\` or \`tailwind.config.ts\` - Tailwind configuration
- \`postcss.config.js\` - PostCSS configuration

## Usage Patterns
- Use utility classes directly in components
- Extend theme in config for custom values
- Use \`@apply\` sparingly in global styles

## Best Practices
- Use consistent spacing scale
- Leverage dark mode variants
- Group related utilities logically
- Use component extraction for repeated patterns
`,
            metadata: {
              version: '1.0.0',
              dependencies: ['tailwindcss'],
              allowedTools: ['Read', 'Edit', 'Write'],
            },
          });
        }

        // ESLint/Prettier
        if (deps.eslint || deps.prettier) {
          generatedSkills.push({
            id: generateId(),
            name: 'Code Quality Tools',
            description: 'Configure and use ESLint and Prettier for code linting and formatting.',
            category: 'config',
            enabled: true,
            detectedFrom: 'package.json',
            content: `# Code Quality Tools Skill

## Overview
This project uses ${deps.eslint ? 'ESLint' : ''}${deps.eslint && deps.prettier ? ' and ' : ''}${deps.prettier ? 'Prettier' : ''} for code quality.

## Configuration Files
${deps.eslint ? '- `.eslintrc.*` or `eslint.config.*` - ESLint rules' : ''}
${deps.prettier ? '- `.prettierrc` or `prettier.config.*` - Formatting rules' : ''}

## Common Commands
\`\`\`bash
${deps.eslint ? '# Run ESLint\nnpm run lint\n\n# Fix auto-fixable issues\nnpm run lint -- --fix\n' : ''}
${deps.prettier ? '# Format code\nnpm run format\n\n# Check formatting\nnpm run format:check' : ''}
\`\`\`

## Best Practices
- Run linting before commits (use husky)
- Fix warnings, don't just ignore them
- Consistent formatting across the team
`,
            metadata: {
              version: '1.0.0',
              dependencies: [deps.eslint ? 'eslint' : '', deps.prettier ? 'prettier' : ''].filter(
                Boolean
              ),
              allowedTools: ['Read', 'Edit', 'Write', 'Bash'],
            },
          });
        }
      }

      setSkills(generatedSkills);
      toast.success('Skills generated', {
        description: `Generated ${generatedSkills.length} skills from project analysis`,
      });
    } catch (error) {
      logger.error('Failed to generate skills:', error);
      toast.error('Failed to generate skills', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsGenerating(false);
    }
  }, [currentProject, readFileContent]);

  // Run analysis if not already done
  const runAnalysis = useCallback(async () => {
    if (!currentProject) return;

    setIsAnalyzing(true);
    try {
      const fileTree = await scanDirectory(currentProject.path);
      const countNodes = (
        nodes: FileTreeNode[]
      ): { files: number; dirs: number; byExt: Record<string, number> } => {
        let files = 0;
        let dirs = 0;
        const byExt: Record<string, number> = {};

        const traverse = (items: FileTreeNode[]) => {
          for (const item of items) {
            if (item.isDirectory) {
              dirs++;
              if (item.children) traverse(item.children);
            } else {
              files++;
              if (item.extension) {
                byExt[item.extension] = (byExt[item.extension] || 0) + 1;
              }
            }
          }
        };

        traverse(nodes);
        return { files, dirs, byExt };
      };

      const counts = countNodes(fileTree);
      const analysis: ProjectAnalysis = {
        fileTree,
        totalFiles: counts.files,
        totalDirectories: counts.dirs,
        filesByExtension: counts.byExt,
        analyzedAt: new Date().toISOString(),
      };

      setProjectAnalysis(analysis);
    } catch (error) {
      logger.error('Analysis failed:', error);
    } finally {
      setIsAnalyzing(false);
    }
  }, [currentProject, scanDirectory, setIsAnalyzing, setProjectAnalysis]);

  // Export skills to .claude/skills/ directory
  const exportSkills = useCallback(async () => {
    if (!currentProject) return;

    const enabledSkills = skills.filter((s) => s.enabled);
    if (enabledSkills.length === 0) {
      toast.error('No skills to export', {
        description: 'Enable at least one skill to export',
      });
      return;
    }

    setIsExporting(true);
    const api = getElectronAPI();
    const skillsDir = `${currentProject.path}/.claude/skills`;
    const exportedIds = new Set<string>();

    try {
      // Create .claude/skills directory
      await api.mkdir(skillsDir);

      // Export each enabled skill
      for (const skill of enabledSkills) {
        const skillName = skill.name.toLowerCase().replace(/\s+/g, '-');
        const skillDir = `${skillsDir}/${skillName}`;
        const skillFile = `${skillDir}/SKILL.md`;

        // Create skill directory
        await api.mkdir(skillDir);

        // Write SKILL.md
        const content = generateSkillMarkdown(skill);
        await api.writeFile(skillFile, content);
        exportedIds.add(skill.id);
      }

      setExportedSkills(exportedIds);
      toast.success('Skills exported', {
        description: `Exported ${enabledSkills.length} skill(s) to .claude/skills/`,
      });
    } catch (error) {
      logger.error('Failed to export skills:', error);
      toast.error('Failed to export skills', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsExporting(false);
    }
  }, [currentProject, skills]);

  // Handle edit dialog save
  const handleSaveEdit = () => {
    if (!editedSkill) return;

    setSkills((prev) => prev.map((s) => (s.id === editedSkill.id ? editedSkill : s)));
    setIsEditDialogOpen(false);
    setEditedSkill(null);
    toast.success('Skill updated');
  };

  // Copy skill content to clipboard
  const copySkillContent = (skill: GeneratedSkill) => {
    const content = generateSkillMarkdown(skill);
    navigator.clipboard.writeText(content);
    toast.success('Copied to clipboard');
  };

  // Check if project needs analysis
  const needsAnalysis = !projectAnalysis && currentProject;

  if (!currentProject) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="skills-view-no-project">
        <div className="text-center">
          <Wand2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">No Project Selected</h2>
          <p className="text-muted-foreground">Open or create a project to generate skills.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden content-bg" data-testid="skills-view">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-glass backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Wand2 className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold">Skills Generator</h1>
            <p className="text-sm text-muted-foreground">
              Generate Claude Agent Skills from {currentProject.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={generateSkillsFromAnalysis}
            disabled={isGenerating || isAnalyzing}
            data-testid="generate-skills-button"
          >
            {isGenerating ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Generating...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                {skills.length > 0 ? 'Regenerate' : 'Generate Skills'}
              </>
            )}
          </Button>
          <Button
            onClick={exportSkills}
            disabled={isExporting || skills.filter((s) => s.enabled).length === 0}
            data-testid="export-skills-button"
          >
            {isExporting ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Export to .claude/skills/
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Search/Filter Bar - only show when skills exist */}
      {skills.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 bg-muted/30">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search skills by name, description, or dependency..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
              data-testid="skills-search-input"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                onClick={() => setSearchQuery('')}
                data-testid="clear-search-button"
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as SkillCategory | 'all')}
              className="h-9 px-3 rounded-md border border-input bg-background text-sm"
              data-testid="category-filter-select"
            >
              <option value="all">All Categories</option>
              {allCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {getCategoryLabel(cat)}
                </option>
              ))}
            </select>
          </div>

          {/* Bulk Actions */}
          <div className="flex items-center gap-1 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={enableAllVisible}
              disabled={filteredSkills.length === 0 || filteredSkills.every((s) => s.enabled)}
              className="h-9"
              data-testid="enable-all-button"
            >
              <ToggleRight className="w-4 h-4 mr-1" />
              Enable All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={disableAllVisible}
              disabled={filteredSkills.length === 0 || filteredSkills.every((s) => !s.enabled)}
              className="h-9"
              data-testid="disable-all-button"
            >
              <ToggleLeft className="w-4 h-4 mr-1" />
              Disable All
            </Button>
          </div>

          {/* Result Count */}
          {(searchQuery || categoryFilter !== 'all') && (
            <Badge variant="secondary" className="text-xs">
              {filteredSkills.length} of {skills.length}
            </Badge>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {needsAnalysis && !isGenerating ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Wand2 className="w-16 h-16 text-muted-foreground/50 mb-4" />
            <h2 className="text-lg font-semibold mb-2">Generate Skills</h2>
            <p className="text-sm text-muted-foreground mb-4 max-w-md">
              Click "Generate Skills" to analyze your project and automatically create Claude Agent
              Skills based on your tech stack, APIs, databases, and CI/CD configuration.
            </p>
            <Button onClick={generateSkillsFromAnalysis} data-testid="generate-skills-button-empty">
              <Wand2 className="w-4 h-4 mr-2" />
              Generate Skills
            </Button>
          </div>
        ) : isGenerating ? (
          <div className="flex flex-col items-center justify-center h-full">
            <Spinner size="xl" className="mb-4" />
            <p className="text-muted-foreground">Analyzing project and generating skills...</p>
          </div>
        ) : skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <FileText className="w-16 h-16 text-muted-foreground/50 mb-4" />
            <h2 className="text-lg font-semibold mb-2">No Skills Detected</h2>
            <p className="text-sm text-muted-foreground mb-4 max-w-md">
              We couldn't automatically detect any skills from your project. This might happen if
              your project doesn't have a package.json or uses an uncommon tech stack.
            </p>
          </div>
        ) : filteredSkills.length === 0 && (searchQuery || categoryFilter !== 'all') ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Search className="w-16 h-16 text-muted-foreground/50 mb-4" />
            <h2 className="text-lg font-semibold mb-2">No Matching Skills</h2>
            <p className="text-sm text-muted-foreground mb-4 max-w-md">
              No skills match your search criteria.
              {searchQuery && ` Try a different search term.`}
              {categoryFilter !== 'all' && ` Try selecting a different category.`}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setSearchQuery('');
                setCategoryFilter('all');
              }}
              data-testid="clear-filters-button"
            >
              <X className="w-4 h-4 mr-2" />
              Clear Filters
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Badge variant="outline" className="text-sm">
                      {filteredSkills.length === skills.length
                        ? `${skills.length} skill${skills.length !== 1 ? 's' : ''} detected`
                        : `${filteredSkills.length} of ${skills.length} skills shown`}
                    </Badge>
                    <Badge
                      variant={skills.filter((s) => s.enabled).length > 0 ? 'default' : 'secondary'}
                      className="text-sm"
                    >
                      {skills.filter((s) => s.enabled).length} enabled
                    </Badge>
                  </div>
                  {exportedSkills.size > 0 && (
                    <div className="flex items-center gap-2 text-sm text-green-500">
                      <Check className="w-4 h-4" />
                      <span>
                        {exportedSkills.size} skill{exportedSkills.size !== 1 ? 's' : ''} exported
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Skills by category */}
            {activeCategories.map((category) => {
              const categorySkills = skillsByCategory.get(category) || [];
              const Icon = getCategoryIcon(category);
              const isExpanded = expandedCategories.has(category);

              return (
                <Collapsible
                  key={category}
                  open={isExpanded}
                  onOpenChange={() => toggleCategory(category)}
                >
                  <Card>
                    <CollapsibleTrigger asChild>
                      <CardHeader className="cursor-pointer hover:bg-accent/50 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-muted-foreground" />
                            )}
                            <Icon className="w-5 h-5 text-primary" />
                            <CardTitle className="text-base">
                              {getCategoryLabel(category)}
                            </CardTitle>
                          </div>
                          <Badge variant="secondary">{categorySkills.length}</Badge>
                        </div>
                      </CardHeader>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="pt-0 space-y-3">
                        {categorySkills.map((skill) => (
                          <div
                            key={skill.id}
                            className={cn(
                              'flex items-center justify-between p-3 rounded-lg border',
                              skill.enabled
                                ? 'bg-primary/5 border-primary/20'
                                : 'bg-muted/50 border-border'
                            )}
                            data-testid={`skill-card-${skill.id}`}
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <Switch
                                checked={skill.enabled}
                                onCheckedChange={() => toggleSkillEnabled(skill.id)}
                                data-testid={`skill-toggle-${skill.id}`}
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium truncate">{skill.name}</span>
                                  {exportedSkills.has(skill.id) && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs text-green-500 border-green-500/30"
                                    >
                                      Exported
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm text-muted-foreground truncate">
                                  {skill.description}
                                </p>
                                <p className="text-xs text-muted-foreground/70 mt-1">
                                  Detected from: {skill.detectedFrom}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 ml-3">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedSkill(skill);
                                  setIsPreviewDialogOpen(true);
                                }}
                                data-testid={`preview-skill-${skill.id}`}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditedSkill({ ...skill });
                                  setIsEditDialogOpen(true);
                                }}
                                data-testid={`edit-skill-${skill.id}`}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copySkillContent(skill)}
                                data-testid={`copy-skill-${skill.id}`}
                              >
                                <Copy className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              );
            })}
          </div>
        )}
      </div>

      {/* Preview Dialog */}
      <Dialog open={isPreviewDialogOpen} onOpenChange={setIsPreviewDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5" />
              Preview: {selectedSkill?.name}
            </DialogTitle>
            <DialogDescription>
              This is how the SKILL.md file will look when exported.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <pre className="p-4 bg-muted rounded-lg text-sm font-mono whitespace-pre-wrap">
              {selectedSkill && generateSkillMarkdown(selectedSkill)}
            </pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPreviewDialogOpen(false)}>
              Close
            </Button>
            {selectedSkill && (
              <Button onClick={() => copySkillContent(selectedSkill)}>
                <Copy className="w-4 h-4 mr-2" />
                Copy to Clipboard
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-5 h-5" />
              Edit Skill
            </DialogTitle>
            <DialogDescription>
              Modify the skill metadata and content before exporting.
            </DialogDescription>
          </DialogHeader>
          {editedSkill && (
            <div className="flex-1 overflow-auto space-y-4">
              <div className="space-y-2">
                <Label htmlFor="skill-name">Name</Label>
                <Input
                  id="skill-name"
                  value={editedSkill.name}
                  onChange={(e) => setEditedSkill({ ...editedSkill, name: e.target.value })}
                  maxLength={64}
                  data-testid="edit-skill-name"
                />
                <p className="text-xs text-muted-foreground">
                  Maximum 64 characters. Will be converted to kebab-case for the skill ID.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="skill-description">Description</Label>
                <Textarea
                  id="skill-description"
                  value={editedSkill.description}
                  onChange={(e) => setEditedSkill({ ...editedSkill, description: e.target.value })}
                  maxLength={200}
                  className="resize-none"
                  rows={2}
                  data-testid="edit-skill-description"
                />
                <p className="text-xs text-muted-foreground">
                  Maximum 200 characters. Claude uses this to determine when to invoke the skill.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="skill-content">Content (Markdown body)</Label>
                <Textarea
                  id="skill-content"
                  value={editedSkill.content}
                  onChange={(e) => setEditedSkill({ ...editedSkill, content: e.target.value })}
                  className="font-mono text-sm min-h-[200px]"
                  data-testid="edit-skill-content"
                />
                <p className="text-xs text-muted-foreground">
                  The markdown content that tells Claude what to do. Keep under 500 lines.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="skill-version">Version (optional)</Label>
                <Input
                  id="skill-version"
                  value={editedSkill.metadata.version || ''}
                  onChange={(e) =>
                    setEditedSkill({
                      ...editedSkill,
                      metadata: { ...editedSkill.metadata, version: e.target.value },
                    })
                  }
                  placeholder="1.0.0"
                  data-testid="edit-skill-version"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit}>
              <Check className="w-4 h-4 mr-2" />
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
