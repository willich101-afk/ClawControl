import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { Skill, CronJob } from '../lib/openclaw'
import type { ClawHubSkill, ClawHubSort } from '../lib/clawhub'

export function RightPanel() {
  const {
    rightPanelOpen,
    setRightPanelOpen,
    rightPanelTab,
    setRightPanelTab,
    skills,
    cronJobs,
    selectSkill,
    selectCronJob,
    selectedSkill,
    selectedCronJob,
    skillsSubTab,
    setSkillsSubTab,
    clawHubSkills,
    clawHubLoading,
    clawHubSort,
    setClawHubSort,
    searchClawHubSkills,
    selectClawHubSkill,
    selectedClawHubSkill
  } = useStore()

  const [searchQuery, setSearchQuery] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filteredSkills = skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.description.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredCronJobs = cronJobs.filter(
    (job) =>
      job.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.schedule.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Debounced search for ClawHub
  useEffect(() => {
    if (rightPanelTab !== 'skills' || skillsSubTab !== 'available') return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      searchClawHubSkills(searchQuery)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchQuery, skillsSubTab, rightPanelTab, searchClawHubSkills])

  return (
    <aside className={`right-panel ${rightPanelOpen ? 'visible' : 'hidden'}`}>
      <div className="panel-header">
        <div className="panel-tabs">
          <button
            className={`panel-tab ${rightPanelTab === 'skills' ? 'active' : ''}`}
            onClick={() => setRightPanelTab('skills')}
          >
            Skills
          </button>
          <button
            className={`panel-tab ${rightPanelTab === 'crons' ? 'active' : ''}`}
            onClick={() => setRightPanelTab('crons')}
          >
            Cron Jobs
          </button>
        </div>
        <button
          className="panel-close"
          onClick={() => setRightPanelOpen(false)}
          aria-label="Close panel"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="panel-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {rightPanelTab === 'skills' ? (
        <>
          <div className="skills-sub-tabs">
            <button
              className={`skills-sub-tab ${skillsSubTab === 'installed' ? 'active' : ''}`}
              onClick={() => setSkillsSubTab('installed')}
            >
              Installed
            </button>
            <button
              className={`skills-sub-tab ${skillsSubTab === 'available' ? 'active' : ''}`}
              onClick={() => setSkillsSubTab('available')}
            >
              Available
            </button>
          </div>

          {skillsSubTab === 'installed' ? (
            <div className="panel-content">
              {filteredSkills.length > 0 ? (
                filteredSkills.map((skill, index) => (
                  <SkillItem
                    key={skill.id || index}
                    skill={skill}
                    isSelected={selectedSkill?.id === skill.id}
                    onClick={() => selectSkill(skill)}
                  />
                ))
              ) : (
                <div className="empty-panel">
                  <p>No skills found</p>
                </div>
              )}
            </div>
          ) : (
            <div className="panel-content">
              <div className="clawhub-sort">
                <label>Sort by</label>
                <select
                  value={clawHubSort}
                  onChange={(e) => setClawHubSort(e.target.value as ClawHubSort)}
                >
                  <option value="downloads">Downloads</option>
                  <option value="stars">Stars</option>
                  <option value="trending">Trending</option>
                  <option value="updated">Recently Updated</option>
                </select>
              </div>

              {clawHubLoading ? (
                <div className="empty-panel">
                  <div className="clawhub-loading-spinner" />
                  <p>Loading skills...</p>
                </div>
              ) : clawHubSkills.length > 0 ? (
                clawHubSkills.map((skill) => (
                  <ClawHubSkillItem
                    key={skill.slug}
                    skill={skill}
                    isSelected={selectedClawHubSkill?.slug === skill.slug}
                    onClick={() => selectClawHubSkill(skill)}
                  />
                ))
              ) : (
                <div className="empty-panel">
                  <p>No skills found on ClawHub</p>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="panel-content">
          {filteredCronJobs.length > 0 ? (
            filteredCronJobs.map((job, index) => (
              <CronJobItem
                key={job.id || index}
                job={job}
                isSelected={selectedCronJob?.id === job.id}
                onClick={() => selectCronJob(job)}
              />
            ))
          ) : (
            <div className="empty-panel">
              <p>No cron jobs found</p>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

interface SkillItemProps {
  skill: Skill
  isSelected: boolean
  onClick: () => void
}

function SkillItem({ skill, isSelected, onClick }: SkillItemProps) {
  return (
    <div
      className={`skill-item clickable ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      <div className="skill-header">
        <div className="skill-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
          </svg>
        </div>
        <div className={`skill-status ${skill.enabled !== false ? 'enabled' : 'disabled'}`}>
          {skill.enabled !== false ? 'Enabled' : 'Disabled'}
        </div>
      </div>
      <div className="skill-content">
        <div className="skill-name">{skill.name}</div>
        <div className="skill-description">{skill.description}</div>
        <div className="skill-triggers">
          {skill.triggers.map((trigger, index) => (
            <span key={trigger || index} className="trigger-badge">
              {trigger}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

interface ClawHubSkillItemProps {
  skill: ClawHubSkill
  isSelected: boolean
  onClick: () => void
}

function ClawHubSkillItem({ skill, isSelected, onClick }: ClawHubSkillItemProps) {
  return (
    <div
      className={`clawhub-skill-item clickable ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      <div className="clawhub-skill-header">
        <div className="clawhub-skill-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
          </svg>
        </div>
        {skill.version && (
          <span className="clawhub-version">v{skill.version}</span>
        )}
      </div>
      <div className="clawhub-skill-content">
        <div className="clawhub-skill-name">{skill.name}</div>
        <div className="clawhub-skill-desc">{skill.description}</div>
        <div className="clawhub-skill-meta">
          <span className="clawhub-stat" title="Downloads">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            {formatCount(skill.downloads)}
          </span>
          <span className="clawhub-stat" title="Stars">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {formatCount(skill.stars)}
          </span>
          {skill.owner.username && (
            <span className="clawhub-stat owner">
              {skill.owner.username}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function formatCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

interface CronJobItemProps {
  job: CronJob
  isSelected: boolean
  onClick: () => void
}

function CronJobItem({ job, isSelected, onClick }: CronJobItemProps) {
  const { client, fetchCronJobs } = useStore()

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await client?.toggleCronJob(job.id, job.status === 'paused')
    await fetchCronJobs()
  }

  return (
    <div
      className={`cron-item clickable ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      <div className={`cron-status ${job.status}`} />
      <div className="cron-content">
        <div className="cron-name">{job.name}</div>
        <div className="cron-schedule">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <span>{job.schedule}</span>
        </div>
        <div className="cron-next">
          {job.status === 'paused' ? 'Paused' : `Next run: ${job.nextRun || 'Unknown'}`}
        </div>
      </div>
      <button className="cron-toggle" onClick={handleToggle} aria-label="Toggle cron job">
        {job.status === 'paused' ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        )}
      </button>
    </div>
  )
}
