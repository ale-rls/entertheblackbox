<icecast>
    <location>venue</location>
    <admin>ops@localhost</admin>

    <limits>
        <!-- 100 players + operator monitors + load-test headroom -->
        <clients>${ICECAST_MAX_CLIENTS}</clients>
        <!-- one liquidsoap source per player mount -->
        <sources>${ICECAST_MAX_SOURCES}</sources>
        <!-- Icecast's stock default is 524288 (~32s @128kbps). That lets a
             client that's briefly slow (wifi hiccup, backgrounding) accumulate
             a large backlog instead of being dropped, and once it catches up
             an <audio> element plays that backlog sequentially rather than
             skipping to the live edge — the delay becomes permanent. Kept
             just above burst-size, so a lagging client disconnects quickly
             and the phone's watchdog reconnects fresh (SPEC §4.3, §5). -->
        <queue-size>65536</queue-size>
        <client-timeout>30</client-timeout>
        <header-timeout>15</header-timeout>
        <source-timeout>10</source-timeout>
        <!-- small burst = low cue-to-ear latency (SPEC §4.3); raise if
             phones on bad wifi stutter at connect -->
        <burst-on-connect>1</burst-on-connect>
        <burst-size>16384</burst-size>
    </limits>

    <authentication>
        <source-password>${ICECAST_SOURCE_PASSWORD_XML}</source-password>
        <relay-password>${ICECAST_RELAY_PASSWORD_XML}</relay-password>
        <admin-user>admin</admin-user>
        <admin-password>${ICECAST_ADMIN_PASSWORD_XML}</admin-password>
    </authentication>

    <hostname>${ICECAST_HOSTNAME_XML}</hostname>

    <listen-socket>
        <port>8000</port>
    </listen-socket>

    <http-headers>
        <header name="Access-Control-Allow-Origin" value="*" />
    </http-headers>

    <!-- private venue deployment: never announce to YP directories -->
    <directory>
    </directory>

    <fileserve>1</fileserve>

    <paths>
        <basedir>/usr/share/icecast</basedir>
        <logdir>/tmp</logdir>
        <webroot>/usr/share/icecast/web</webroot>
        <adminroot>/usr/share/icecast/admin</adminroot>
    </paths>

    <logging>
        <accesslog>-</accesslog>
        <errorlog>-</errorlog>
        <loglevel>3</loglevel>
    </logging>
</icecast>
