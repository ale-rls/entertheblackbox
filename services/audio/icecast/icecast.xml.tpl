<icecast>
    <location>venue</location>
    <admin>ops@localhost</admin>

    <limits>
        <!-- 100 players + operator monitors + load-test headroom -->
        <clients>${ICECAST_MAX_CLIENTS}</clients>
        <!-- one liquidsoap source per player mount -->
        <sources>${ICECAST_MAX_SOURCES}</sources>
        <queue-size>524288</queue-size>
        <client-timeout>30</client-timeout>
        <header-timeout>15</header-timeout>
        <source-timeout>10</source-timeout>
        <!-- small burst = low cue-to-ear latency (SPEC §4.3); raise if
             phones on bad wifi stutter at connect -->
        <burst-on-connect>1</burst-on-connect>
        <burst-size>16384</burst-size>
    </limits>

    <authentication>
        <source-password>${ICECAST_SOURCE_PASSWORD}</source-password>
        <relay-password>${ICECAST_RELAY_PASSWORD}</relay-password>
        <admin-user>admin</admin-user>
        <admin-password>${ICECAST_ADMIN_PASSWORD}</admin-password>
    </authentication>

    <hostname>${ICECAST_HOSTNAME}</hostname>

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
